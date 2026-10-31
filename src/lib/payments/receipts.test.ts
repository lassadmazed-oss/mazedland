import { describe, expect, it } from "vitest";
import { isPdfReceipt, MAX_RECEIPT_MB, MAX_RECEIPTS, ownReceiptPaths, receiptProblem } from "./receipts";

const MB = 1024 * 1024;

describe("what a receipt may be", () => {
  it("a photo or a PDF, even when the picker gives no type", () => {
    expect(receiptProblem({ name: "recu.jpg", type: "image/jpeg", size: 2 * MB })).toBeNull();
    expect(receiptProblem({ name: "IMG_0042.HEIC", type: "", size: 3 * MB })).toBeNull();
    expect(receiptProblem({ name: "virement.pdf", type: "", size: MB })).toBeNull();
    expect(receiptProblem({ name: "notes.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: MB })).toBe("format");
  });

  it("not beyond the size cap", () => {
    expect(receiptProblem({ name: "big.png", type: "image/png", size: (MAX_RECEIPT_MB + 1) * MB })).toBe("size");
  });

  it("a PDF goes as it is; a photo is compressed", () => {
    expect(isPdfReceipt({ name: "a.PDF", type: "" })).toBe(true);
    expect(isPdfReceipt({ name: "a.png", type: "image/png" })).toBe(false);
  });
});

describe("the receipt paths a request names", () => {
  const me = "11111111-2222-4333-8444-555555555555";
  it("the payer's own, at most three", () => {
    const five = [0, 1, 2, 3, 4].map((i) => `${me}/p-${i}.webp`);
    expect(ownReceiptPaths(five, me)).toEqual(five.slice(0, MAX_RECEIPTS));
    expect(ownReceiptPaths(["", 3, null, `${me}/a.webp`], me)).toEqual([`${me}/a.webp`]);
    expect(ownReceiptPaths(undefined, me)).toEqual([]);
  });

  it("one that is not theirs refuses them all", () => {
    expect(ownReceiptPaths([`${me}/a.webp`, "someone-else/b.webp"], me)).toBeNull();
    expect(ownReceiptPaths([`${me}/../x/b.webp`], me)).toBeNull();
  });
});
