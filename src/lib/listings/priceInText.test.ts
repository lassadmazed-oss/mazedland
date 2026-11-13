import { describe, expect, it } from "vitest";
import { priceInText, readFigure } from "./priceInText";

describe("readFigure", () => {
  it("reads the groupings Tunisians write", () => {
    expect(readFigure("350 000")).toBe(350000);
    expect(readFigure("350.000")).toBe(350000);
    expect(readFigure("1,300,000")).toBe(1300000);
    expect(readFigure("1 300,50")).toBe(1300.5);
    expect(readFigure("850")).toBe(850);
    expect(readFigure("1,2")).toBe(1.2);
    expect(readFigure("2.5")).toBe(2.5);
  });
});

describe("priceInText", () => {
  it("finds the rent of MZ-01707 and MZ-01733 (the audit of 2026-11-13)", () => {
    expect(priceInText("✅ Proche de toutes commodités :\n💰Loyer:850DT\n📲. Tél: 26 216 130", true)).toEqual({ price: 850, quote: "Loyer:850" });
    expect(priceInText("situé à route mahdia\nprix de location 1300dt\\mois\n• cuisine équipée", true)?.price).toBe(1300);
  });

  it("reads a figure with its currency, in French and in Arabic", () => {
    expect(priceInText("Villa à vendre 450 000 DT négociable", false)?.price).toBe(450000);
    expect(priceInText("شقة للبيع بـ 240000 دينار", false)?.price).toBe(240000);
    expect(priceInText("الكراء 700 د.ت في الشهر", true)?.price).toBe(700);
  });

  it("reads thousands and millions said in words", () => {
    expect(priceInText("السوم 350 ألف قابل للنقاش", false)?.price).toBe(350000);
    expect(priceInText("prix 280 mille dinars", false)?.price).toBe(280000);
    expect(priceInText("Prix : 1,2 million", false)?.price).toBe(1200000);
    expect(priceInText("بـ 2 مليون", false)?.price).toBe(2000000);
  });

  it("reads a price word followed by a figure", () => {
    expect(priceInText("Prix : 350000", false)?.price).toBe(350000);
    expect(priceInText("السعر: 185.000", false)?.price).toBe(185000);
  });

  it("leaves a text that names no price", () => {
    expect(priceInText("الثمن مغري جدا 🔥 لمزيد الاستفسار الرجاء الاتصال", false)).toBeNull();
    expect(priceInText("Pour les réservations et les tarifs, contactez-nous en privé", true)).toBeNull();
    expect(priceInText("", false)).toBeNull();
    expect(priceInText(null, false)).toBeNull();
  });

  it("is not fooled by a surface, a phone number or a price per m²", () => {
    expect(priceInText("Appartement S+3 de 120 m², 3e étage, tél 98 375 007", false)).toBeNull();
    expect(priceInText("Terrain à 1500 DT le m²", false)).toBeNull();
    expect(priceInText("الأرض بـ 300 دينار للمتر", false)).toBeNull();
  });

  it("keeps a sale's price out of a rent and the other way round", () => {
    // 850 TND is no sale price; 450 000 TND is no monthly rent.
    expect(priceInText("Loyer 850 DT", false)).toBeNull();
    expect(priceInText("450 000 DT", true)).toBeNull();
  });

  it("takes the first price the text gives", () => {
    expect(priceInText("Prix 320 000 DT, frais d'agence 5 000 DT", false)?.price).toBe(320000);
  });
});
