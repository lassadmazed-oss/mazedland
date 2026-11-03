import { describe, it, expect } from "vitest";
import { accountBlocker, accountMode, shopBlocker } from "./deletion";

const NOW = new Date("2026-11-03T10:00:00Z");

describe("shopBlocker", () => {
  it("lets an agence with nothing paid running go", () => {
    expect(shopBlocker({ paidUntil: null, now: NOW, pendingPayments: 0 })).toBeNull();
    expect(shopBlocker({ paidUntil: new Date("2026-10-01T00:00:00Z"), now: NOW, pendingPayments: 0 })).toBeNull();
  });

  it("keeps one whose paid period still runs, or whose receipt waits", () => {
    expect(shopBlocker({ paidUntil: new Date("2026-12-01T00:00:00Z"), now: NOW, pendingPayments: 0 })).toBe("paid_plan");
    expect(shopBlocker({ paidUntil: null, now: NOW, pendingPayments: 1 })).toBe("payment_pending");
  });
});

describe("accountBlocker", () => {
  const plain = { isAdmin: false, isSelf: false, pendingPayments: 0, ownsShop: false };

  it("lets a plain account go", () => {
    expect(accountBlocker(plain)).toBeNull();
  });

  it("never the admin's own account, nor a console member's, nor one with money in flight or an agence", () => {
    expect(accountBlocker({ ...plain, isSelf: true })).toBe("self");
    expect(accountBlocker({ ...plain, isAdmin: true })).toBe("admin");
    expect(accountBlocker({ ...plain, pendingPayments: 2 })).toBe("payment_pending");
    expect(accountBlocker({ ...plain, ownsShop: true })).toBe("owns_shop");
  });
});

describe("accountMode", () => {
  it("erases an account that never paid, anonymises one whose invoices must stay", () => {
    expect(accountMode({ payments: 0, invoices: 0 })).toBe("erase");
    expect(accountMode({ payments: 1, invoices: 0 })).toBe("anonymise");
    expect(accountMode({ payments: 0, invoices: 1 })).toBe("anonymise");
  });
});
