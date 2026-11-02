import { describe, expect, it } from "vitest";
import { ASSIST_LIMITS, SUGGESTED_HEADINGS, buildAssistSystemPrompt, buildAssistUserPrompt, cleanAssistMarkdown, parseAssistInput } from "./assist";

describe("parseAssistInput", () => {
  it("reads a request for one section", () => {
    const r = parseAssistInput({ language: "ar", title: "  شراء  عقار ", tags: ["acheter", "x y"], heading: "الخطوات", instruction: " لأوّل شراء ", existing: "## A\r\nنص\n" });
    expect(r).toEqual({
      ok: true,
      value: { language: "ar", title: "شراء عقار", tags: ["acheter"], heading: "الخطوات", instruction: "لأوّل شراء", existing: "## A\nنص" },
    });
  });

  it("keeps only the tail of a long article, and nothing of an empty one", () => {
    const long = "x".repeat(ASSIST_LIMITS.existing + 50);
    const r = parseAssistInput({ language: "fr", title: "T", existing: long });
    expect(r.ok && r.value.existing?.length).toBe(ASSIST_LIMITS.existing);
    const none = parseAssistInput({ language: "fr", title: "T", existing: "   " });
    expect(none.ok && none.value.existing).toBeNull();
    expect(none.ok && none.value.heading).toBeNull();
  });

  it("names what is wrong", () => {
    expect(parseAssistInput({ language: "en", title: "T" })).toEqual({ ok: false, error: "language" });
    expect(parseAssistInput({ language: "fr", title: "" })).toEqual({ ok: false, error: "title" });
    expect(parseAssistInput({ language: "fr", title: "T", heading: "h".repeat(121) })).toEqual({ ok: false, error: "heading" });
    expect(parseAssistInput({ language: "fr", title: "T", instruction: "i".repeat(601) })).toEqual({ ok: false, error: "instruction" });
  });
});

describe("the prompts", () => {
  it("tell the model the rules that matter: Tunisia, no invented number, Markdown only", () => {
    const sys = buildAssistSystemPrompt();
    expect(sys).toMatch(/Tunisia/);
    expect(sys).toMatch(/Never invent a number/);
    expect(sys).toMatch(/no HTML/);
    expect(sys).toMatch(/à vérifier auprès/);
  });

  it("ask for one section or a whole draft, with what exists", () => {
    const one = buildAssistUserPrompt({ language: "fr", title: "T", tags: ["acheter"], heading: "Les frais", instruction: null, existing: "## A" });
    expect(one).toMatch(/ONE section titled: Les frais/);
    expect(one).toMatch(/## A/);
    const whole = buildAssistUserPrompt({ language: "ar", title: "ع", tags: [], heading: null, instruction: "court", existing: null });
    expect(whole).toMatch(/whole guide/);
    expect(whole).toMatch(/Nothing is written yet/);
    expect(whole).toMatch(/The editor asks: court/);
  });

  it("offers section names in both languages", () => {
    expect(SUGGESTED_HEADINGS.fr.length).toBeGreaterThan(3);
    expect(SUGGESTED_HEADINGS.ar.length).toBe(SUGGESTED_HEADINGS.fr.length);
  });
});

describe("cleanAssistMarkdown", () => {
  it("strips HTML, a title heading and links, and keeps the Markdown", () => {
    expect(cleanAssistMarkdown("# Titre\n\n## Étapes\n\nUn <b>mot</b> et [un lien](https://x.tn) puis https://y.tn.\n\n\n\n- a")).toBe(
      "## Étapes\n\nUn mot et un lien puis .\n\n- a",
    );
  });

  it("refuses what is not text and cuts a long draft at a paragraph", () => {
    expect(cleanAssistMarkdown(null)).toBeNull();
    expect(cleanAssistMarkdown("   ")).toBeNull();
    const para = "mot ".repeat(400).trim();
    const long = Array.from({ length: 10 }, () => para).join("\n\n");
    const cut = cleanAssistMarkdown(long)!;
    expect(cut.length).toBeLessThanOrEqual(ASSIST_LIMITS.output);
    expect(cut.endsWith("mot")).toBe(true);
  });
});
