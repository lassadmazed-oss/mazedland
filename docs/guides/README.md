# Starter guides

The ten guides written for Tunisia, in French and Arabic, that « Importer les
guides de départ » (/admin/contenu) brings into the console as **drafts**. The
owner reads, edits and publishes each one; nothing here reaches the site by
itself, and the import never inserts the same guide twice (`source_key`).

## Files

One guide = two files, `<slug>.fr.md` and `<slug>.ar.md`. The slug is the
guide's address under /guides (lower-case words joined by dashes). A file is a
header between two `---` lines and the Markdown body:

```
---
title: Acheter un bien en Tunisie, étape par étape
excerpt: Une ou deux phrases, montrées sous le titre et sur la carte.
tags: acheter, juridique
seo_title: (facultatif) le titre que Google affiche
seo_description: (facultatif) la description que Google affiche
---

## Première section
…
```

`tags` come from the list in `src/lib/guides/articles.ts` (ARTICLE_TAGS).
The body uses the dialect `src/lib/guides/markdown.ts` reads: `##`/`###`
headings, paragraphs, `-` and `1.` lists, `> ` callouts, `| a | b |` tables,
`**bold**`, links. No HTML.

## The rule on facts

Fees, rates, taxes, delays and commissions change with the finance law and
the bank: the guides name an order of magnitude only when it is widely known,
and always say that it must be checked and with whom (« à vérifier auprès du
notaire / de la Recette des Finances / de la banque »). No invented number, no
law article quoted from memory. `src/lib/guides/starter.test.ts` checks the
files' shape; the content is the owner's to read before publishing.
