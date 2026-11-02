/**
 * « Aide à la rédaction » (0208): the model drafts a section of a guide, in
 * French or Arabic, from the guide's title and what is written so far. The
 * draft lands in the editor and nowhere else — the owner reads it, changes it
 * and decides to publish, or not.
 *
 * Pure: the instructions, the answer's schema and the checks on what goes in
 * and comes out. The call itself is src/lib/ai/server.ts (callJson), the one
 * door to the model, with its budget and its log.
 */
import type { ArticleLang } from "./articles";

export const ASSIST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["markdown"],
  properties: {
    markdown: { type: "string" },
  },
} as const;

export const ASSIST_LIMITS = {
  title: 160,
  heading: 120,
  instruction: 600,
  /** How much of the article so far the model reads back (its tail). */
  existing: 6000,
  /** The most a draft may be; past it the end is cut at a paragraph. */
  output: 8000,
} as const;

/**
 * The sections a guide usually has, offered as chips so the editor picks one
 * rather than types — in the language being written, not the console's.
 */
export const SUGGESTED_HEADINGS: Readonly<Record<ArticleLang, readonly string[]>> = {
  fr: ["Les étapes", "Les documents à réunir", "Les frais à prévoir", "Les erreurs à éviter", "À vérifier avant de signer"],
  ar: ["الخطوات", "الوثائق اللازمة", "المصاريف المتوقّعة", "أخطاء يجب تجنّبها", "ما يجب التثبّت منه قبل الإمضاء"],
};

export type AssistInput = {
  language: ArticleLang;
  title: string;
  tags: string[];
  /** The section to write; null = a first draft of the whole guide. */
  heading: string | null;
  /** What the editor asked for, in their words. */
  instruction: string | null;
  /** The body so far, so the draft continues it rather than repeating it. */
  existing: string | null;
};

export function buildAssistSystemPrompt(): string {
  return `You draft practical real-estate guides for Mazed Immo (www.mazed.immo), a Tunisian classifieds site where individuals and agencies sell and rent property. The readers are ordinary Tunisians buying, selling or renting a home, a plot or a shop, often for the first time. An editor will read, correct and publish your draft; nothing you write goes online by itself.

Answer with JSON: {"markdown": "..."} — the draft only, in Markdown.

Markdown you may use: "##" and "###" headings, short paragraphs, "-" bullet lists, "1." numbered lists, **bold** for the few words that matter, "> " for a callout (what to check, what to avoid), and a simple table ("| a | b |" with a "| --- | --- |" line) when two options are compared. Nothing else: no HTML, no images, no links, no code. Do not repeat the guide's title as a heading.

Facts come first:
- Write about Tunisia: its law and its practice (titre foncier / رسم عقاري, Conservation de la propriété foncière / إدارة الملكية العقارية, Recette des finances / القباضة المالية, notaire / عدل إشهاد, promesse de vente / وعد بالبيع, caution / ضمان, promoteur agréé / منعش عقاري).
- Never invent a number: no fee, tax, rate, percentage, delay or article of law that you are not sure of. Where a figure exists but changes (notary fees, registration duties, bank rates, agency commissions, deposits), say that it must be checked and with whom (the notary, the Recette des finances, the bank, the Conservation foncière, the municipality) — in French « à vérifier auprès de … », in Arabic « يجب التثبّت من … لدى … ». A widely known order of magnitude may be given once, marked as indicative.
- Give steps and checks, concretely: what to ask, what to read, what to bring, what to refuse. Recommend a professional (notary, lawyer, surveyor / topographe) where a mistake is costly; never present a legal point as certain advice.
- No phone number, e-mail, address, bank name, agency name or person's name. No promise about Mazed Immo beyond what a classifieds site does (annonces, visit requests, a credit simulator, verified agencies).

Language:
- "fr": plain French, short sentences, the words Tunisians use (dinars, TND, gouvernorat, délégation, S+2, titre foncier).
- "ar": simple Modern Standard Arabic in Arabic script, with the Tunisian terms people say (رسم عقاري، وعد بالبيع، الضمان، الكراء، القباضة المالية). No Latin transliteration, no slang in legal matters. Numbers in Western digits (2026, 20 %).

Length: one section is 150 to 400 words under its heading; a first draft of a whole guide is 500 to 900 words in 4 to 7 sections, ending with a short list of what to check.`;
}

export function buildAssistUserPrompt(input: AssistInput): string {
  const lines = [
    `Language: ${input.language}`,
    `Guide title: ${input.title}`,
    input.tags.length ? `Guide tags: ${input.tags.join(", ")}` : null,
    input.heading ? `Write ONE section titled: ${input.heading} (start with its "##" heading)` : "Write a first draft of the whole guide (its sections, each with a \"##\" heading).",
    input.instruction ? `The editor asks: ${input.instruction}` : null,
    input.existing
      ? `What is already written (do not repeat it; continue after it, in the same voice):\n"""\n${input.existing}\n"""`
      : "Nothing is written yet.",
  ];
  return lines.filter((l): l is string => l !== null).join("\n\n");
}

export type AssistInputError = "language" | "title" | "heading" | "instruction";

/** The editor's request, checked: a language, a title, bounded texts. */
export function parseAssistInput(body: Record<string, unknown>): { ok: true; value: AssistInput } | { ok: false; error: AssistInputError } {
  const language = body.language;
  if (language !== "fr" && language !== "ar") return { ok: false, error: "language" };
  const title = typeof body.title === "string" ? body.title.trim().replace(/\s+/g, " ") : "";
  if (!title || title.length > ASSIST_LIMITS.title) return { ok: false, error: "title" };
  const headingRaw = typeof body.heading === "string" ? body.heading.trim().replace(/\s+/g, " ") : "";
  if (headingRaw.length > ASSIST_LIMITS.heading) return { ok: false, error: "heading" };
  const instructionRaw = typeof body.instruction === "string" ? body.instruction.trim() : "";
  if (instructionRaw.length > ASSIST_LIMITS.instruction) return { ok: false, error: "instruction" };
  const existingRaw = typeof body.existing === "string" ? body.existing.replace(/\r\n?/g, "\n").trim() : "";
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string" && /^[a-z]{2,20}$/.test(t)).slice(0, 8) : [];
  return {
    ok: true,
    value: {
      language,
      title,
      tags,
      heading: headingRaw || null,
      instruction: instructionRaw || null,
      existing: existingRaw ? existingRaw.slice(-ASSIST_LIMITS.existing) : null,
    },
  };
}

/**
 * The draft as it enters the editor: no HTML tag (the renderer would show it
 * as text, which is worse than nothing), no title-level heading, no link, a
 * bounded length cut at a paragraph.
 */
export function cleanAssistMarkdown(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.replace(/\r\n?/g, "\n").replace(/<[^>\n]{1,200}>/g, "").trim();
  // A "# Title" at the top: the guide has its own title field.
  s = s.replace(/^#\s+[^\n]*\n+/, "");
  // Links out: the text stays, the address goes (the sentence's own full stop stays too).
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S*[^\s.,;:!?)]/g, "");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  if (s.length > ASSIST_LIMITS.output) {
    const cut = s.lastIndexOf("\n\n", ASSIST_LIMITS.output);
    s = s.slice(0, cut > ASSIST_LIMITS.output / 2 ? cut : ASSIST_LIMITS.output).trim();
  }
  return s || null;
}
