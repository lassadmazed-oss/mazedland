/**
 * Live comparison of « Vérifier les photos » on two models: the same real
 * photos of recent Prospection leads, read once by Opus and once by Haiku,
 * finding by finding (2026-11-26, before the feature moved to Haiku — on Opus
 * each check cost about 2.4 cents and twenty of them used a member's share).
 *
 * It calls the real models and costs money (about 3 cents a lead on Opus, a
 * tenth of a cent on Haiku), so it only runs when asked:
 *
 *   AI_EVAL=1 npx pnpm vitest run src/lib/prospection/photoCheck.eval.test.ts
 *
 * AI_EVAL_LEADS sets how many leads (default 10). It only reads: no hash, no
 * size, no lead is written. Each call is logged in `ai_calls` under
 * `prospect_photos_eval`, without an account, so no member's share pays for
 * it. With AI_EVAL_OUT (a folder), the photos the two models disagree on are
 * saved there as JPEG with a report.json, for a person to look at.
 */
import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { callJson, type AiModel } from "@/lib/ai/server";
import { readPhoto } from "@/lib/photoHash.server";
import { forTheModel } from "./photoCheck.server";
import {
  PHOTO_CHECK_SCHEMA, PHOTO_CHECK_SYSTEM, coverKindOf, flagsOf, normalizeFindings, suggestOrder, suggestedCover,
  type PhotoFinding, type PhotoFlag,
} from "./photoCheck";

config({ path: ".env.local", quiet: true });

const run = process.env.AI_EVAL === "1" && Boolean(process.env.ANTHROPIC_API_KEY) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const LEADS = Math.max(1, Math.min(30, Number(process.env.AI_EVAL_LEADS) || 10));
const MODELS: AiModel[] = ["claude-opus-5-5", "claude-haiku-5-5"];
const OUT = process.env.AI_EVAL_OUT;

type Read = { findings: (PhotoFinding | null)[]; ok: boolean };

describe.runIf(run)("photo check — Opus against Haiku on real lead photos", () => {
  it("Haiku answers like Opus on what the member acts on", async () => {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const { data: leads } = await admin
      .from("prospect_leads")
      .select("id, listing_id, created_at")
      .not("listing_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(80);

    let photosSeen = 0;
    let compared = 0;
    let sameKind = 0;
    let sameFlags = 0;
    let sameCover = 0;
    let leadsDone = 0;
    const answered: Record<string, number> = Object.fromEntries(MODELS.map((m) => [m, 0]));
    const flagMiss: Record<PhotoFlag, { opusOnly: number; haikuOnly: number }> = {
      phone: { opusOnly: 0, haikuOnly: 0 },
      overlay: { opusOnly: 0, haikuOnly: 0 },
      people: { opusOnly: 0, haikuOnly: 0 },
      not_property: { opusOnly: 0, haikuOnly: 0 },
      low_quality: { opusOnly: 0, haikuOnly: 0 },
      duplicate: { opusOnly: 0, haikuOnly: 0 },
    };
    const report: unknown[] = [];
    if (OUT) fs.mkdirSync(OUT, { recursive: true });

    for (const lead of leads ?? []) {
      if (leadsDone >= LEADS) break;
      const listingId = lead.listing_id as string;
      const { data: rows } = await admin.from("listing_photos").select("storage_path").eq("listing_id", listingId).order("sort_order");
      const paths = (rows ?? []).map((r) => r.storage_path as string).filter(Boolean).slice(0, 12);
      if (paths.length < 2) continue;

      const images: { mediaType: "image/webp"; data: string }[] = [];
      const kept: string[] = [];
      for (const p of paths) {
        const photo = await readPhoto(admin as never, p, 640).catch(() => null);
        if (!photo) continue;
        try {
          images.push({ mediaType: "image/webp", data: await forTheModel(photo.bytes) });
          kept.push(p);
        } catch {
          /* not a photo: left out, as the real check does */
        }
      }
      if (images.length < 2) continue;
      leadsDone += 1;
      photosSeen += images.length;

      const { data: listing } = await admin.from("listings").select("category:categories (kind)").eq("id", listingId).maybeSingle();
      const cat = (listing as { category?: { kind?: string } | { kind?: string }[] | null } | null)?.category;
      const kind = coverKindOf((Array.isArray(cat) ? cat[0] : cat)?.kind);

      const reads: Read[] = await Promise.all(
        MODELS.map(async (model) => {
          const call = await callJson({
            admin: admin as never,
            userId: null,
            feature: "prospect_photos_eval",
            model,
            system: PHOTO_CHECK_SYSTEM,
            user: `Check the ${images.length} photo(s) above and answer for each one, by its index.`,
            schema: PHOTO_CHECK_SCHEMA as unknown as Record<string, unknown>,
            images,
            maxTokens: 3_000,
          });
          if (call.ok) answered[model] += 1;
          return { ok: call.ok, findings: call.ok ? normalizeFindings(call.data, images.length) : images.map(() => null) };
        }),
      );
      const [opus, haiku] = reads;
      const flags = reads.map((r) => r.findings.map((f) => flagsOf(f, false)));
      const covers = reads.map((r, i) => (r.ok ? suggestedCover(suggestOrder(r.findings, flags[i], kind)) : null));
      if (opus.ok && haiku.ok) {
        // suggestedCover gives null when the first photo already is the best one.
        if (covers[0] === covers[1]) sameCover += 1;
      }

      const differences: unknown[] = [];
      for (let i = 0; i < images.length; i++) {
        const a = opus.findings[i];
        const b = haiku.findings[i];
        if (!a || !b) continue;
        compared += 1;
        if (a.kind === b.kind) sameKind += 1;
        const fa = new Set(flags[0][i]);
        const fb = new Set(flags[1][i]);
        const same = fa.size === fb.size && [...fa].every((f) => fb.has(f));
        if (same) sameFlags += 1;
        for (const f of fa) if (!fb.has(f)) flagMiss[f].opusOnly += 1;
        for (const f of fb) if (!fa.has(f)) flagMiss[f].haikuOnly += 1;
        if (!same || a.kind !== b.kind) {
          const file = `${String(leadsDone).padStart(2, "0")}-${i}.jpg`;
          differences.push({ photo: i, file, opus: a, haiku: b, opusFlags: [...fa], haikuFlags: [...fb] });
          if (OUT) {
            const bytes = Buffer.from(images[i].data, "base64");
            await sharp(bytes).jpeg({ quality: 80 }).toFile(path.join(OUT, file));
          }
        }
      }
      report.push({ lead: lead.id, listing: listingId, photos: images.length, kind, covers: { opus: covers[0], haiku: covers[1] }, differences });
    }

    const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)} %` : "—");
    const summary = {
      leads: leadsDone,
      photos: photosSeen,
      answered,
      compared,
      sameKind: `${sameKind}/${compared} (${pct(sameKind, compared)})`,
      sameFlags: `${sameFlags}/${compared} (${pct(sameFlags, compared)})`,
      sameCover: `${sameCover}/${leadsDone} (${pct(sameCover, leadsDone)})`,
      flagMiss,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (OUT) fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ summary, report }, null, 2));
    expect(leadsDone).toBeGreaterThan(0);
    expect(answered["claude-haiku-5-5"]).toBe(leadsDone);
  }, 900_000);
});
