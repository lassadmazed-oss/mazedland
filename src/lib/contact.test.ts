import { describe, expect, it } from "vitest";
import { facebookHref, tiktokHandle, tiktokHref, whatsappHref } from "./contact";

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
});
