/**
 * Live comparison of « Vérifier les photos » on two models: the same real
 * photos of recent Prospection leads, read by each model, finding by finding
 * (2026-11-26, before the feature moved off Opus — there each check cost about
 * 2.4 cents and twenty of them used a member's daily share).
 *
 * It calls the real models and costs money (about 3 cents a lead on Opus, a
 * tenth of a cent on Haiku), so it only runs when asked:
 *
 *   AI_EVAL=1 npx pnpm vitest run src/lib/prospection/photoCheck.eval.test.ts
 *
 * - AI_EVAL_MODELS: the models, comma-separated, the first one being the
 *   reference (default « claude-opus-5-5,claude-haiku-5-5 »). One model alone
 *   only records what it found.
 * - AI_EVAL_LEADS: how many leads (default 10), the most recent ones with at
 *   least two photos; AI_EVAL_LEAD_IDS (comma-separated) runs those instead,
 *   so a second run reads the very same photos.
 * - AI_EVAL_OUT: a folder where report.json (every finding of every model) and
 *   the photos worth a look (a disagreement, or a phone, a mark, a face, not
 *   the property) are saved as JPEG, for a person to check.
 *
 * It only reads: no hash, no size, no lead is written. Each call is logged in
 * `ai_calls` under `prospect_photos_eval`, without an account, so no member's
 * share pays for it.
 */
import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { AI_MODELS, callJson, type AiModel } from "@/lib/ai/server";
import { readPhoto } from "@/lib/photoHash.server";
import { forTheModel } from "./photoCheck.server";
import {
  PHOTO_CHECK_SCHEMA, PHOTO_CHECK_SYSTEM, coverKindOf, flagsOf, normalizeFindings, suggestOrder, suggestedCover,
  type PhotoFinding, type PhotoFlag,
} from "./photoCheck";

config({ path: ".env.local", quiet: true });

const run = process.env.AI_EVAL === "1" && Boolean(process.env.ANTHROPIC_API_KEY) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const LEADS = Math.max(1, Math.min(30, Number(process.env.AI_EVAL_LEADS) || 10));
const LEAD_IDS = (process.env.AI_EVAL_LEAD_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const asked = (process.env.AI_EVAL_MODELS ?? "claude-opus-5-5,claude-haiku-5-5").split(",").map((s) => s.trim());
const MODELS = asked.filter((m): m is AiModel => (AI_MODELS as readonly string[]).includes(m));
const OUT = process.env.AI_EVAL_OUT;
/** The flags that make a member look at a photo again before it goes online. */
const WORTH_A_LOOK: readonly PhotoFlag[] = ["phone", "overlay", "people", "not_property"];

type Read = { findings: (PhotoFinding | null)[]; ok: boolean };

describe.runIf(run)("photo check — models compared on real lead photos", () => {
  it("every model answers, and the second one is measured against the first", async () => {
    expect(MODELS.length).toBeGreaterThan(0);
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    let q = admin.from("prospect_leads").select("id, listing_id, created_at").not("listing_id", "is", null);
    q = LEAD_IDS.length ? q.in("id", LEAD_IDS) : q.order("created_at", { ascending: false }).limit(80);
    const { data: found } = await q;
    const leads = LEAD_IDS.length
      ? LEAD_IDS.map((id) => (found ?? []).find((l) => l.id === id)).filter((l): l is NonNullable<typeof l> => Boolean(l))
      : (found ?? []);
    const limit = LEAD_IDS.length ? LEAD_IDS.length : LEADS;

    let photosSeen = 0;
    let compared = 0;
    let sameKind = 0;
    let sameFlags = 0;
    let sameCover = 0;
    let leadsDone = 0;
    const answered: Record<string, number> = Object.fromEntries(MODELS.map((m) => [m, 0]));
    const flagCount: Record<string, Partial<Record<PhotoFlag, number>>> = Object.fromEntries(MODELS.map((m) => [m, {}]));
    const flagMiss: Partial<Record<PhotoFlag, { onlyFirst: number; onlySecond: number }>> = {};
    const report: unknown[] = [];
    if (OUT) fs.mkdirSync(OUT, { recursive: true });

    for (const lead of leads) {
      if (leadsDone >= limit) break;
      const listingId = lead.listing_id as string;
      const { data: rows } = await admin.from("listing_photos").select("storage_path").eq("listing_id", listingId).order("sort_order");
      const paths = (rows ?? []).map((r) => r.storage_path as string).filter(Boolean).slice(0, 12);
      if (paths.length < 2) continue;

      const images: { mediaType: "image/webp"; data: string }[] = [];
      for (const p of paths) {
        const photo = await readPhoto(admin as never, p, 640).catch(() => null);
        if (!photo) continue;
        try {
          images.push({ mediaType: "image/webp", data: await forTheModel(photo.bytes) });
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
      const flags = reads.map((r) => r.findings.map((f) => flagsOf(f, false)));
      // suggestedCover gives null when the first photo already is the best one.
      const covers = reads.map((r, m) => (r.ok ? suggestedCover(suggestOrder(r.findings, flags[m], kind)) : null));
      reads.forEach((_, m) => flags[m].forEach((list) => list.forEach((f) => (flagCount[MODELS[m]][f] = (flagCount[MODELS[m]][f] ?? 0) + 1))));

      const worthALook = new Set<number>();
      if (reads.length >= 2 && reads[0].ok && reads[1].ok) {
        if (covers[0] === covers[1]) sameCover += 1;
        for (let i = 0; i < images.length; i++) {
          const a = reads[0].findings[i];
          const b = reads[1].findings[i];
          if (!a || !b) continue;
          compared += 1;
          if (a.kind === b.kind) sameKind += 1;
          const fa = new Set(flags[0][i]);
          const fb = new Set(flags[1][i]);
          const same = fa.size === fb.size && [...fa].every((f) => fb.has(f));
          if (same) sameFlags += 1;
          else worthALook.add(i);
          if (a.kind !== b.kind) worthALook.add(i);
          for (const f of fa) if (!fb.has(f)) (flagMiss[f] ??= { onlyFirst: 0, onlySecond: 0 }).onlyFirst += 1;
          for (const f of fb) if (!fa.has(f)) (flagMiss[f] ??= { onlyFirst: 0, onlySecond: 0 }).onlySecond += 1;
        }
      }
      flags.forEach((perPhoto) => perPhoto.forEach((list, i) => list.some((f) => WORTH_A_LOOK.includes(f)) && worthALook.add(i)));

      const file = (i: number) => `${String(leadsDone).padStart(2, "0")}-${i}.jpg`;
      if (OUT) {
        for (const i of worthALook) {
          await sharp(Buffer.from(images[i].data, "base64")).jpeg({ quality: 80 }).toFile(path.join(OUT, file(i)));
        }
      }
      report.push({
        lead: lead.id,
        listing: listingId,
        photos: images.length,
        kind,
        covers: Object.fromEntries(MODELS.map((m, n) => [m, covers[n]])),
        worthALook: [...worthALook].sort((x, y) => x - y).map(file),
        findings: Object.fromEntries(
          MODELS.map((m, n) => [
            m,
            reads[n].findings.map((f, i) => (f ? { i, kind: f.kind, quality: f.quality, overlay: f.overlayText, flags: flags[n][i] } : null)),
          ]),
        ),
      });
    }

    const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)} %` : "—");
    const summary = {
      models: MODELS,
      leads: leadsDone,
      photos: photosSeen,
      answered,
      flagCount,
      ...(MODELS.length >= 2
        ? {
            compared,
            sameKind: `${sameKind}/${compared} (${pct(sameKind, compared)})`,
            sameFlags: `${sameFlags}/${compared} (${pct(sameFlags, compared)})`,
            sameCover: `${sameCover}/${leadsDone} (${pct(sameCover, leadsDone)})`,
            flagMiss,
          }
        : {}),
    };
    console.log(JSON.stringify(summary, null, 2));
    if (OUT) fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ summary, report }, null, 2));
    expect(leadsDone).toBeGreaterThan(0);
    for (const m of MODELS) expect(answered[m]).toBe(leadsDone);
  }, 900_000);
});
