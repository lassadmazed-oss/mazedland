import { describe, expect, it } from "vitest";
import { listingFields } from "@/lib/listings/input";
import {
  confirmBlockers,
  contactsLeft,
  draftToListingBody,
  extractPhones,
  fillTemplate,
  normalizePhone,
  photoPathOf,
  propertyLine,
  publishBlockers,
  readDraft,
  startOfTunisiaDay,
  statusAfter,
  TEAM_ATTESTATION,
} from "./model";
import { ASK_AR, ASK_FR, SMS_AR, SMS_FR } from "./templates";

describe("normalizePhone", () => {
  it("writes a Tunisian number as +216XXXXXXXX however it was typed", () => {
    expect(normalizePhone("58415521")).toBe("+21658415521");
    expect(normalizePhone("58 415 521")).toBe("+21658415521");
    expect(normalizePhone("+216 58 41 55 21")).toBe("+21658415521");
    expect(normalizePhone("0021658415521")).toBe("+21658415521");
    expect(normalizePhone("216-58-415-521")).toBe("+21658415521");
  });

  it("reads Arabic-Indic digits", () => {
    expect(normalizePhone("٥٨٤١٥٥٢١")).toBe("+21658415521");
  });

  it("refuses what is not an owner's line", () => {
    expect(normalizePhone("1234567")).toBeNull();
    expect(normalizePhone("80123456")).toBeNull(); // 8x: service lines
    expect(normalizePhone("+33612345678")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});

describe("extractPhones", () => {
  it("finds the numbers a post carries, once each, in order", () => {
    const post = "دار للبيع في صفاقس 350 000 د، للاتصال 58 415 521 أو 21658415521 وكذلك 98.124.111";
    expect(extractPhones(post)).toEqual(["+21658415521", "+21698124111"]);
  });

  it("does not read a price or a surface as a number", () => {
    expect(extractPhones("Villa 300 m² à 1 200 000 DT, 350000 négociable")).toEqual([]);
  });

  it("does not take eight digits out of a longer run", () => {
    expect(extractPhones("réf 1258415521999")).toEqual([]);
  });

  it("reads digits written in Arabic-Indic form", () => {
    expect(extractPhones("اتصل بـ ٩٨ ١٢٤ ١١١")).toEqual(["+21698124111"]);
  });
});

describe("fillTemplate", () => {
  it("fills the holes", () => {
    expect(fillTemplate("Bonjour {name}, {property}", { name: "Sami", property: "Villa" })).toBe("Bonjour Sami, Villa");
  });

  it("drops an empty hole and tidies what was around it", () => {
    expect(fillTemplate("Bonjour {name}, votre annonce ({property})", { name: "", property: "Villa" })).toBe(
      "Bonjour, votre annonce (Villa)",
    );
    expect(fillTemplate("سلام {name}، نحبو ({terms})", { name: undefined, terms: "" })).toBe("سلام، نحبو");
  });

  it("keeps the lines of an SMS", () => {
    const out = fillTemplate(SMS_FR, { link: "https://x/a", manage: "https://x/g/t", phone: "+21658415510" });
    expect(out.split("\n")).toHaveLength(3);
    expect(out).toContain("https://x/g/t");
  });

  it("ships messages with every hole the owner needs", () => {
    for (const t of [ASK_AR, ASK_FR]) {
      expect(t).toContain("{property}");
      expect(t).toContain("{terms}");
    }
    for (const t of [SMS_AR, SMS_FR]) {
      expect(t).toContain("{link}");
      expect(t).toContain("{manage}");
    }
  });
});

describe("readDraft", () => {
  it("reads anything stored without trusting it", () => {
    const d = readDraft({ deal: "rent", price: "1200", areaSqm: -3, rooms: 3, legal: { titled: true, x: true }, questions: ["السوم؟", 5, ""] });
    expect(d.deal).toBe("rent");
    expect(d.price).toBe(1200);
    expect(d.areaSqm).toBeNull();
    expect(d.rooms).toBe(3);
    expect(d.legal).toEqual({ titled: true });
    expect(d.questions).toEqual(["السوم؟"]);
    expect(readDraft(null).deal).toBe("sale");
  });
});

describe("draftToListingBody", () => {
  const draft = readDraft({
    deal: "sale", categorySlug: "maisons", governorate: "Sfax", delegation: "Sfax Ville", price: 350000, areaSqm: 180,
    rooms: 3, legal: { titled: true }, title: "دار 180 م² · صفاقس", description: "دار قريبة من الطريق.",
  });

  it("gives the columns a seller's own form would", () => {
    const fields = listingFields(draftToListingBody(draft, { categoryId: "cat-1", contactName: "Sami", contactPhone: "+21658415521" }));
    expect(fields.category_id).toBe("cat-1");
    expect(fields.title).toBe("دار 180 م² · صفاقس");
    expect(fields.price).toBe(350000);
    expect(fields.price_on_request).toBe(false);
    expect(fields.governorate).toBe("Sfax");
    expect(fields.attributes).toEqual({ area_sqm: 180, rooms: 3, titled: true });
    expect(fields.contact_phone).toBe("+21658415521");
    expect(fields.seller_attestation_version).toBe(TEAM_ATTESTATION);
  });

  it("leaves a price the post did not give as « sur demande », never a guess", () => {
    const fields = listingFields(draftToListingBody({ ...draft, price: null }, { categoryId: "c", contactName: null, contactPhone: "+21658415521" }));
    expect(fields.price).toBeNull();
    expect(fields.price_on_request).toBe(true);
  });

  it("carries the rent facts only for a rent", () => {
    const rent = readDraft({ ...draft, deal: "rent", price: 900, deposit: 1800, furnished: "furnished" });
    const f = listingFields(draftToListingBody(rent, { categoryId: "c", contactName: null, contactPhone: "+21658415521" }));
    expect(f.deal_type).toBe("rent");
    expect(f.deposit_amount).toBe(1800);
    const sale = listingFields(draftToListingBody(draft, { categoryId: "c", contactName: null, contactPhone: "+21658415521" }));
    expect(sale.deposit_amount).toBeNull();
  });
});

describe("confirmBlockers", () => {
  const draft = readDraft({ categorySlug: "maisons", governorate: "Sfax", title: "دار" });
  const ok = { status: "contacted" as const, phone: "+21658415521", doNotContact: false, draft, reply: "نعم موافق", channel: "whatsapp" as const };

  it("lets a contacted lead with its proof through", () => {
    expect(confirmBlockers(ok)).toEqual([]);
    expect(confirmBlockers({ ...ok, status: "to_contact" })).toEqual([]);
  });

  it("asks for the owner's own words, the channel, and a number that may be written to", () => {
    expect(confirmBlockers({ ...ok, reply: " " })).toContain("no_reply");
    expect(confirmBlockers({ ...ok, channel: null })).toContain("no_channel");
    expect(confirmBlockers({ ...ok, phone: null })).toContain("no_phone");
    expect(confirmBlockers({ ...ok, doNotContact: true })).toContain("do_not_contact");
  });

  it("asks for what the annonce cannot do without", () => {
    expect(confirmBlockers({ ...ok, draft: readDraft({}) })).toEqual(["no_category", "no_governorate", "no_title"]);
  });

  it("is only for a lead that has not said yes already", () => {
    expect(confirmBlockers({ ...ok, status: "confirmed" })).toContain("wrong_step");
    expect(confirmBlockers({ ...ok, status: "declined" })).toContain("wrong_step");
    expect(confirmBlockers({ ...ok, status: "online" })).toContain("wrong_step");
  });
});

describe("publishBlockers", () => {
  const base = { status: "confirmed" as const, hasListing: true, photoCount: 3, minPhotos: 3, photosChecked: true, draft: readDraft({ price: 100000 }) };

  it("opens when the yes is recorded, the photos are in and checked", () => {
    expect(publishBlockers(base)).toEqual([]);
  });

  it("holds the site's own minimum of photos, and at least one", () => {
    expect(publishBlockers({ ...base, photoCount: 2 })).toEqual(["photos"]);
    expect(publishBlockers({ ...base, photoCount: 0, minPhotos: 0 })).toEqual(["photos"]);
  });

  it("wants the photos looked at: no phone number, no other agency's mark", () => {
    expect(publishBlockers({ ...base, photosChecked: false })).toEqual(["photos_not_checked"]);
  });

  it("does not publish before the yes, or without a price", () => {
    expect(publishBlockers({ ...base, status: "contacted" })).toContain("wrong_step");
    expect(publishBlockers({ ...base, hasListing: false })).toContain("no_listing");
    expect(publishBlockers({ ...base, draft: readDraft({}) })).toContain("no_price");
  });
});

describe("statusAfter", () => {
  it("moves a lead along as things are recorded", () => {
    expect(statusAfter("to_contact", "contacted")).toBe("contacted");
    expect(statusAfter("to_contact", "no_answer")).toBe("contacted");
    expect(statusAfter("contacted", "thinking")).toBe("contacted");
    expect(statusAfter("contacted", "refused")).toBe("declined");
    expect(statusAfter("contacted", "wrong_number")).toBe("declined");
    expect(statusAfter("contacted", "confirmed")).toBe("confirmed");
    expect(statusAfter("confirmed", "published")).toBe("online");
  });

  it("never takes back a yes, nor an annonce that is online", () => {
    expect(statusAfter("confirmed", "refused")).toBe("confirmed");
    expect(statusAfter("online", "refused")).toBe("online");
    expect(statusAfter("online", "contacted")).toBe("online");
  });

  it("leaves a note where it found the lead", () => {
    expect(statusAfter("contacted", "note")).toBe("contacted");
  });
});

describe("the day", () => {
  it("counts what is left of the daily cap", () => {
    expect(contactsLeft(30, 12)).toBe(18);
    expect(contactsLeft(30, 45)).toBe(0);
  });

  it("starts at midnight in Tunisia (UTC+1)", () => {
    expect(startOfTunisiaDay(new Date("2026-11-13T10:00:00Z"))).toBe("2026-11-12T23:00:00.000Z");
    expect(startOfTunisiaDay(new Date("2026-11-13T23:30:00Z"))).toBe("2026-11-13T23:00:00.000Z");
  });
});

describe("propertyLine", () => {
  it("names the property by its title, else by what is known", () => {
    expect(propertyLine(readDraft({ title: "دار 180 م²" }))).toBe("دار 180 م²");
    expect(propertyLine(readDraft({ governorate: "Sfax", areaSqm: 200 }))).toBe("Sfax · 200 m²");
  });
});

describe("photoPathOf", () => {
  const seller = "587dbe08-1ad6-43d7-9a4d-151657ef537e";

  it("keeps a path the publish form would write into the owner's own folder", () => {
    expect(photoPathOf(seller, `${seller}/annonce-1794584929437-723878-0.webp`)).toBe(`${seller}/annonce-1794584929437-723878-0.webp`);
  });

  it("drops a path in someone else's folder, a traversal, or anything not shaped like a photo", () => {
    expect(photoPathOf(seller, "00000000-0000-0000-0000-000000000000/annonce-1-2-0.webp")).toBeNull();
    expect(photoPathOf(seller, `${seller}/../other/annonce-1-2-0.webp`)).toBeNull();
    expect(photoPathOf(seller, `${seller}/logo.png`)).toBeNull();
    expect(photoPathOf(seller, `${seller}/annonce-1-2-0.exe;rm`)).toBeNull();
    expect(photoPathOf(seller, 42)).toBeNull();
  });
});
