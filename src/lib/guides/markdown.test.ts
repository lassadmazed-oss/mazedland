import { describe, expect, it } from "vitest";
import { headingId, inlineText, outline, parseInline, parseMarkdown, plainText, readingMinutes, safeHref, wordCount } from "./markdown";

describe("safeHref", () => {
  it("keeps web pages, mail, phone, the site's own paths and anchors", () => {
    expect(safeHref("https://www.cpf.gov.tn/")).toBe("https://www.cpf.gov.tn/");
    expect(safeHref("http://example.tn/a?b=1")).toBe("http://example.tn/a?b=1");
    expect(safeHref("mailto:contact@mazed.immo")).toBe("mailto:contact@mazed.immo");
    expect(safeHref("tel:+21698124111")).toBe("tel:+21698124111");
    expect(safeHref("/annonces?deal=rent")).toBe("/annonces?deal=rent");
    expect(safeHref("#les-etapes")).toBe("#les-etapes");
  });

  it("refuses what would run code, leave the site unnoticed or carry a password", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("JavaScript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>")).toBeNull();
    expect(safeHref("vbscript:x")).toBeNull();
    expect(safeHref("//evil.example/x")).toBeNull();
    expect(safeHref("https://mazed.immo@evil.example/")).toBeNull();
    expect(safeHref("https://localhost/x")).toBeNull();
    expect(safeHref("https://a.tn/with space")).toBeNull();
    expect(safeHref("")).toBeNull();
    expect(safeHref("#")).toBeNull();
  });
});

describe("parseInline", () => {
  it("reads bold, italic, code and links", () => {
    expect(parseInline("un **mot** et *un autre* et `code`")).toEqual([
      { t: "text", v: "un " },
      { t: "strong", c: [{ t: "text", v: "mot" }] },
      { t: "text", v: " et " },
      { t: "em", c: [{ t: "text", v: "un autre" }] },
      { t: "text", v: " et " },
      { t: "code", v: "code" },
    ]);
    expect(parseInline("voir [le guide](/guides/x) ici")).toEqual([
      { t: "text", v: "voir " },
      { t: "link", href: "/guides/x", c: [{ t: "text", v: "le guide" }] },
      { t: "text", v: " ici" },
    ]);
  });

  it("drops the address of an unsafe link and keeps its words", () => {
    expect(parseInline("[clic](javascript:alert(1))")).toEqual([{ t: "text", v: "clic" }]);
    expect(parseInline("[x](data:text/html,a)")).toEqual([{ t: "text", v: "x" }]);
  });

  it("links a bare address without its trailing punctuation", () => {
    expect(parseInline("Voir https://www.cpf.gov.tn/page.")).toEqual([
      { t: "text", v: "Voir " },
      { t: "link", href: "https://www.cpf.gov.tn/page", c: [{ t: "text", v: "https://www.cpf.gov.tn/page" }] },
      { t: "text", v: "." },
    ]);
  });

  it("leaves HTML as text and underscores inside words alone", () => {
    expect(parseInline("<b>gras</b> <script>x</script>")).toEqual([{ t: "text", v: "<b>gras</b> <script>x</script>" }]);
    expect(parseInline("snake_case_name")).toEqual([{ t: "text", v: "snake_case_name" }]);
    expect(parseInline("prix \\*hors\\* taxes")).toEqual([{ t: "text", v: "prix *hors* taxes" }]);
  });

  it("keeps a lone star or an unclosed bracket as text", () => {
    expect(inlineText(parseInline("5 * 3 = 15"))).toBe("5 * 3 = 15");
    expect(inlineText(parseInline("[pas un lien"))).toBe("[pas un lien");
    expect(inlineText(parseInline("**sans fin"))).toBe("**sans fin");
  });

  it("reads Arabic emphasis and links", () => {
    expect(parseInline("**الرسم العقاري** ثم [الدليل](/guides/x)")).toEqual([
      { t: "strong", c: [{ t: "text", v: "الرسم العقاري" }] },
      { t: "text", v: " ثم " },
      { t: "link", href: "/guides/x", c: [{ t: "text", v: "الدليل" }] },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("reads headings, paragraphs, lists, quotes, rules and tables", () => {
    const blocks = parseMarkdown(
      [
        "# Titre",
        "",
        "Un paragraphe",
        "sur deux lignes.",
        "",
        "## Les étapes",
        "- un",
        "- deux",
        "  - sous",
        "1. premier",
        "2. second",
        "",
        "> À vérifier",
        "> auprès du notaire.",
        "",
        "---",
        "",
        "| Poste | Qui |",
        "| --- | --- |",
        "| Droits | Recette |",
        "| Notaire |",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.t)).toEqual(["heading", "paragraph", "heading", "list", "list", "quote", "rule", "table"]);
    // A top-level "#" is shown as a second-level heading: the title is the page's h1.
    expect(blocks[0]).toMatchObject({ t: "heading", level: 2, id: "titre", text: "Titre" });
    expect(plainText([blocks[1]])).toBe("Un paragraphe sur deux lignes.");
    expect(blocks[3]).toMatchObject({ t: "list", ordered: false });
    const ul = blocks[3] as Extract<ReturnType<typeof parseMarkdown>[number], { t: "list" }>;
    expect(ul.items).toHaveLength(2);
    expect(ul.items[1].sub).toMatchObject({ ordered: false });
    expect(inlineText(ul.items[1].sub!.items[0])).toBe("sous");
    expect(blocks[4]).toMatchObject({ t: "list", ordered: true });
    const quote = blocks[5] as Extract<ReturnType<typeof parseMarkdown>[number], { t: "quote" }>;
    expect(quote.c[0].t).toBe("paragraph");
    expect(plainText(quote.c)).toBe("À vérifier auprès du notaire.");
    const table = blocks[7] as Extract<ReturnType<typeof parseMarkdown>[number], { t: "table" }>;
    expect(table.head.map(inlineText)).toEqual(["Poste", "Qui"]);
    // A short row is squared to the header.
    expect(table.rows.map((r) => r.map(inlineText))).toEqual([["Droits", "Recette"], ["Notaire", ""]]);
  });

  it("keeps a fenced block literal and never makes HTML of it", () => {
    const blocks = parseMarkdown("```\n<script>alert(1)</script>\n```");
    expect(blocks).toEqual([{ t: "code", v: "<script>alert(1)</script>" }]);
  });

  it("gives headings unique anchors, in Latin and in Arabic", () => {
    const blocks = parseMarkdown("## Les frais\n\n## Les frais\n\n## الوثائق اللازمة\n\n## !!!");
    expect(outline(blocks).map((h) => h.id)).toEqual(["les-frais", "les-frais-2", "الوثائق-اللازمة", "section"]);
    const taken = new Set<string>();
    expect(headingId("Étape 1 : le titre", taken)).toBe("etape-1-le-titre");
    expect(headingId("Étape 1 : le titre", taken)).toBe("etape-1-le-titre-2");
  });

  it("caps heading depth at four and treats Windows line endings as lines", () => {
    const blocks = parseMarkdown("### Trois\r\n\r\n###### Six\r\n\r\ntexte");
    expect(outline(blocks).map((h) => h.level)).toEqual([3, 4]);
    expect(blocks[2]).toMatchObject({ t: "paragraph" });
  });

  it("separates a paragraph from a list that follows without a blank line", () => {
    const blocks = parseMarkdown("Demandez :\n- le titre\n- le certificat");
    expect(blocks.map((b) => b.t)).toEqual(["paragraph", "list"]);
  });
});

describe("reading", () => {
  it("counts words in both scripts and never says less than a minute", () => {
    expect(wordCount("un deux trois — 4")).toBe(4);
    expect(wordCount("كلمة أخرى ثالثة")).toBe(3);
    expect(readingMinutes("court")).toBe(1);
    expect(readingMinutes(Array.from({ length: 600 }, () => "mot").join(" "))).toBe(3);
  });

  it("flattens the article to its words", () => {
    const text = plainText(parseMarkdown("## A\n\nUn **mot**.\n\n- x\n- y\n\n| a | b |\n| --- | --- |\n| 1 | 2 |"));
    expect(text).toBe("A Un mot. x y a b 1 2");
  });
});
