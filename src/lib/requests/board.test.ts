import { describe, expect, it } from "vitest";
import { BOARD_COLUMNS, boardCards, boardShown, boardSince, boardTotals, type BoardRow } from "./board";
import { SETTINGS } from "@/lib/settings/registry";

const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  id: "r1",
  deal_type: "sale",
  category_ids: ["apt"],
  governorates: ["Sfax"],
  budget_min: null,
  budget_max: 150000,
  surface_min: 100,
  rooms_min: 2,
  furnished: null,
  created_at: "2026-11-16T10:00:00Z",
  ...over,
});

describe("boardTotals", () => {
  it("counts where and what, most asked first", () => {
    const t = boardTotals([
      row({ id: "a" }),
      row({ id: "b", governorates: ["Sfax", "Tunis"] }),
      row({ id: "c", deal_type: "rent", category_ids: [], governorates: [] }),
      row({ id: "d", category_ids: ["land"], governorates: ["Tunis"] }),
    ]);
    expect(t.total).toBe(4);
    expect(t.sale).toBe(3);
    expect(t.rent).toBe(1);
    expect(t.byGovernorate).toEqual([
      { governorate: "Sfax", count: 2 },
      { governorate: "Tunis", count: 2 },
      { governorate: null, count: 1 },
    ]);
    expect(t.byKind).toEqual([
      { deal: "sale", categoryId: "apt", count: 2 },
      { deal: "sale", categoryId: "land", count: 1 },
      { deal: "rent", categoryId: null, count: 1 },
    ]);
  });

  it("counts a governorate named twice once", () => {
    expect(boardTotals([row({ governorates: ["Sfax", "Sfax"] })]).byGovernorate).toEqual([{ governorate: "Sfax", count: 1 }]);
  });

  it("is empty with no demande", () => {
    expect(boardTotals([])).toEqual({ total: 0, sale: 0, rent: 0, byGovernorate: [], byKind: [] });
  });
});

describe("boardCards", () => {
  const rows = [
    row({ id: "old", created_at: "2026-11-02T09:00:00Z" }),
    row({ id: "new", created_at: "2026-11-16T09:00:00Z" }),
    row({ id: "newer", deal_type: "rent", furnished: "furnished", created_at: "2026-11-17T09:00:00Z" }),
  ];

  it("shows only the demandes saved under the public text, newest first", () => {
    expect(boardCards(rows, "2026-11-15T20:00:00Z").map((c) => c.id)).toEqual(["newer", "new"]);
  });

  it("shows none while no moment is set (the old promise: Pro agencies only)", () => {
    expect(boardCards(rows, "")).toEqual([]);
    expect(boardCards(rows, "bientôt")).toEqual([]);
    expect(boardCards(rows, null)).toEqual([]);
  });

  it("carries criteria only: no note, no zone, no move-in date, no person", () => {
    const [card] = boardCards([row({ id: "x", created_at: "2026-11-16T09:00:00Z" })], "2026-11-15");
    expect(Object.keys(card).sort()).toEqual(
      ["budgetMax", "budgetMin", "categoryIds", "createdAt", "deal", "furnished", "governorates", "id", "roomsMin", "surfaceMin"].sort(),
    );
    expect(BOARD_COLUMNS).not.toMatch(/user_id|note|zone|move_in_by|phone|name/);
  });

  it("keeps « meublé » for a rental only, and drops empty numbers", () => {
    const [sale] = boardCards([row({ furnished: "furnished", budget_min: "0", surface_min: null, rooms_min: 0 })], "2026-01-01");
    expect(sale.furnished).toBeNull();
    expect(sale.budgetMin).toBeNull();
    expect(sale.surfaceMin).toBeNull();
    expect(sale.roomsMin).toBeNull();
    const [rent] = boardCards([row({ deal_type: "rent", furnished: "furnished" })], "2026-01-01");
    expect(rent.furnished).toBe("furnished");
  });

  it("stops at the number asked", () => {
    const many = Array.from({ length: 30 }, (_, i) => row({ id: `r${i}`, created_at: `2026-11-16T10:${String(i).padStart(2, "0")}:00Z` }));
    expect(boardCards(many, "2026-11-15", 24)).toHaveLength(24);
  });
});

describe("boardSince / boardShown", () => {
  it("reads a date or a date-time", () => {
    expect(boardSince("2026-11-15")).toBe(Date.parse("2026-11-15"));
    expect(boardSince("2026-11-15T21:30:00Z")).toBe(Date.parse("2026-11-15T21:30:00Z"));
    expect(boardSince(" ")).toBeNull();
  });

  it("keeps quiet under the minimum", () => {
    expect(boardShown(2, 3)).toBe(false);
    expect(boardShown(3, 3)).toBe(true);
    expect(boardShown(1, 0)).toBe(true);
    expect(boardShown(0, 0)).toBe(false);
  });

  it("ships on, with no card until the console sets the moment", () => {
    expect(SETTINGS.requests_board.default).toBe(true);
    expect(SETTINGS.requests_board_cards_since.default).toBe("");
  });
});
