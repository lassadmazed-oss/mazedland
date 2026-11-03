import { describe, expect, it } from "vitest";
import { facebookHref, instagramHandle, instagramHref, mazedLinks, tiktokHandle, tiktokHref, whatsappHref } from "./contact";

describe("contact links", () => {
  it("opens a WhatsApp chat from any written number", () => {
    expect(whatsappHref("+216 58 415 510")).toBe("https://wa.me/21658415510");
  });

  it("reads the TikTok handle however the admin typed it", () => {
    for (const v of ["mazedimmo", "@mazedimmo", " @mazedimmo ", "https://www.tiktok.com/@mazedimmo?lang=fr"]) {
      expect(tiktokHandle(v), v).toBe("mazedimmo");
    }
    expect(tiktokHref("@mazedimmo")).toBe("https://www.tiktok.com/@mazedimmo");
  });

  it("links a Facebook page by id, by name or by its pasted link", () => {
    expect(facebookHref("100057517755322")).toBe("https://www.facebook.com/profile.php?id=100057517755322");
    expect(facebookHref("mazedimmo")).toBe("https://www.facebook.com/mazedimmo");
    expect(facebookHref("https://www.facebook.com/mazedimmo")).toBe("https://www.facebook.com/mazedimmo");
  });

  it("reads the Instagram handle however the admin typed it", () => {
    for (const v of ["mazed_immo", "@mazed_immo", " @mazed_immo ", "https://www.instagram.com/mazed_immo/", "https://instagram.com/mazed_immo?igsh=abc"]) {
      expect(instagramHandle(v), v).toBe("mazed_immo");
    }
    expect(instagramHref("@mazed_immo")).toBe("https://www.instagram.com/mazed_immo/");
  });

  it("lists Mazed Immo's own addresses for a link to pick, leaving the empty ones out", () => {
    expect(
      mazedLinks({ contact_facebook: "100057517755322", contact_instagram: "mazed_immo", contact_tiktok: "@mazedimmo", contact_email: " contact@mazed.immo " }),
    ).toEqual([
      { key: "facebook", href: "https://www.facebook.com/profile.php?id=100057517755322" },
      { key: "instagram", href: "https://www.instagram.com/mazed_immo/" },
      { key: "tiktok", href: "https://www.tiktok.com/@mazedimmo" },
      { key: "email", href: "mailto:contact@mazed.immo" },
    ]);
    expect(mazedLinks({ contact_facebook: "", contact_instagram: " ", contact_tiktok: "", contact_email: "" })).toEqual([]);
  });
});
