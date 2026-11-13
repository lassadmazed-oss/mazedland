import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import fr from "../../../messages/fr.json";
import ar from "../../../messages/ar.json";

/**
 * The screens of Prospection say everything with `t("some.key")`, and a key
 * that is missing prints as its own name in front of the team (found in the
 * first run on the live database: « adminProspection.work.contactedDone »).
 * Every literal key a screen asks for must exist in French and in Arabic.
 * Keys built from a variable (`t(`col.${status}`)`) are checked by hand below.
 */
const ROOT = process.cwd();
const SCREENS: [namespace: string, file: string][] = [
  ["adminProspection", "src/app/[locale]/admin/prospection/page.tsx"],
  ["adminProspection", "src/app/[locale]/admin/prospection/NewLeadForm.tsx"],
  ["adminProspection", "src/app/[locale]/admin/prospection/LeadWorkspace.tsx"],
  ["adminProspection", "src/app/[locale]/admin/prospection/nouveau/page.tsx"],
  ["adminProspection", "src/app/[locale]/admin/prospection/[id]/page.tsx"],
  ["manage", "src/app/[locale]/gerer/[token]/page.tsx"],
  ["manage", "src/app/[locale]/gerer/[token]/ManageActions.tsx"],
];

const get = (o: unknown, p: string): unknown =>
  p.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);

describe("Prospection messages", () => {
  it("has every literal key its screens ask for, in French and in Arabic", () => {
    const missing: string[] = [];
    for (const [ns, file] of SCREENS) {
      const src = fs.readFileSync(path.join(ROOT, file), "utf8");
      for (const m of src.matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)) {
        for (const [lang, msgs] of [["fr", fr], ["ar", ar]] as const) {
          if (get(msgs, `${ns}.${m[1]}`) === undefined) missing.push(`${lang}: ${ns}.${m[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("has every key built from a variable", () => {
    const expected: [string, string[]][] = [
      ["adminProspection.col", ["to_contact", "contacted", "confirmed", "online", "declined"]],
      ["adminProspection.empty", ["to_contact", "contacted", "confirmed", "online"]],
      ["adminProspection.work.outcome", ["no_answer", "thinking", "refused", "wrong_number"]],
      ["adminProspection.work.channel", ["whatsapp", "sms", "call", "messenger", "other"]],
      ["adminProspection.work.event", ["created", "contacted", "no_answer", "thinking", "refused", "wrong_number", "confirmed", "published", "sms", "note", "assigned", "broker"]],
      ["adminProspection.work.confirmBlockers", ["wrong_step", "no_phone", "do_not_contact", "no_category", "no_governorate", "no_title", "no_reply", "no_channel"]],
      ["adminProspection.work.publishBlockers", ["wrong_step", "no_listing", "photos", "photos_not_checked", "no_price"]],
      ["adminProspection.new.errors", ["too_short", "do_not_contact", "rate_limited", "failed"]],
      ["manage.status", ["published", "pending_review", "draft", "rejected", "sold", "rented", "archived", "expired", "pending_payment"]],
    ];
    const missing: string[] = [];
    for (const [base, keys] of expected) {
      for (const k of keys) {
        for (const [lang, msgs] of [["fr", fr], ["ar", ar]] as const) {
          if (get(msgs, `${base}.${k}`) === undefined) missing.push(`${lang}: ${base}.${k}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("escapes the {holes} of a message in the settings hints, so the console can print them", () => {
    for (const msgs of [fr, ar]) {
      const reg = (msgs as unknown as { settingsRegistry: Record<string, { hint: string }> }).settingsRegistry;
      for (const key of ["prospect_ask_ar", "prospect_ask_fr", "prospect_sms_ar", "prospect_sms_fr"]) {
        // An unquoted {name} would be read as an argument nobody passes.
        expect(reg[key].hint.replace(/'\{\w+\}'/g, "")).not.toMatch(/\{\w+\}/);
      }
    }
  });
});
