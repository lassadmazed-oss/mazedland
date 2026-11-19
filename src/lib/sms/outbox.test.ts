import { describe, expect, it } from "vitest";
import {
  DOWN_RUN, digitsOf, failureReason, failuresAfter, isProviderFailure, ownerSmsListing, parseOutbox, providerDown, smsCarriesLink,
  type OutboxRow,
} from "./outbox";

// What WinSMS really stored as the status on 2026-11-14 (HTML-escaped, as get-inbox gives it).
const FATAL =
  "&lt;br /&gt;\n&lt;b&gt;Fatal error&lt;/b&gt;:  Uncaught mysqli_sql_exception: Connection refused in /var/www/html/prive/API/sendsms.php:12\nStack trace:\n#0 /var/www/html/prive/API/sendsms.php(12): mysqli_connect()";

const row = (id: number, status: string, over: Partial<OutboxRow> = {}): OutboxRow => ({ id, phone: "21622906937", sms: "x", segments: 1, type: "plain", status, ...over });

describe("parseOutbox", () => {
  it("reads get-inbox's list, oldest first, and leaves out what has no id", () => {
    const rows = parseOutbox([
      { id: "30", from: "MAZED", phone: "216111", sms: "b", segments: "2", status: "Success", type: "unicode" },
      { id: "10", phone: "216222", sms: "a", segments: 1, status: FATAL, type: "plain" },
      { phone: "no id" },
      null,
    ]);
    expect(rows.map((r) => r.id)).toEqual([10, 30]);
    expect(rows[1]).toEqual({ id: 30, phone: "216111", sms: "b", segments: 2, type: "unicode", status: "Success" });
  });

  it("also reads a list wrapped in data or messages, and answers nothing for anything else", () => {
    expect(parseOutbox({ data: [{ id: 1 }] })).toHaveLength(1);
    expect(parseOutbox({ messages: [{ id: 1 }] })).toHaveLength(1);
    expect(parseOutbox({ code: "101", message: "Wrong action" })).toEqual([]);
    expect(parseOutbox("nope")).toEqual([]);
  });
});

describe("isProviderFailure", () => {
  it("says yes to the provider's own errors", () => {
    expect(isProviderFailure(FATAL)).toBe(true);
    expect(isProviderFailure("cURL error 7: Failed to connect to PROVIDER port 80")).toBe(true);
    expect(isProviderFailure("Connection refused")).toBe(true);
  });

  it("says no to a number that cannot be reached, a delivered message, or one still waiting", () => {
    expect(isProviderFailure("Mobile Error SMS counted")).toBe(false);
    expect(isProviderFailure("Success")).toBe(false);
    expect(isProviderFailure("Sent,delivered")).toBe(false);
    expect(isProviderFailure("")).toBe(false);
  });
});

describe("failureReason", () => {
  it("names the failure in a word", () => {
    expect(failureReason(FATAL)).toBe("Connection refused");
    expect(failureReason("cURL error 7: Failed to connect")).toBe("cURL error");
    expect(failureReason("<b>Fatal error</b>: something else")).toBe("Fatal error");
  });
});

describe("providerDown", () => {
  it("is down when the newest messages all failed on the provider's side", () => {
    const ok = [row(1, "Success"), row(2, "Success")];
    expect(providerDown([...ok, row(3, FATAL), row(4, FATAL), row(5, FATAL)])).toBe(true);
    expect(DOWN_RUN).toBe(3);
  });

  it("is not down for one bad message, a streak that ended, or a short list", () => {
    expect(providerDown([row(1, "Success"), row(2, FATAL), row(3, "Success")])).toBe(false);
    expect(providerDown([row(1, FATAL), row(2, FATAL), row(3, FATAL), row(4, "Mobile Error SMS counted")])).toBe(false);
    expect(providerDown([row(1, FATAL), row(2, FATAL)])).toBe(false);
    expect(providerDown([])).toBe(false);
  });

  it("does not take a dead number for an outage", () => {
    expect(providerDown([row(1, "Mobile Error SMS counted"), row(2, "Mobile Error SMS counted"), row(3, "Mobile Error SMS counted")])).toBe(false);
  });
});

describe("failuresAfter", () => {
  it("keeps the provider failures newer than the last one looked into", () => {
    const rows = [row(1, FATAL), row(2, "Success"), row(3, FATAL), row(4, "Mobile Error SMS counted"), row(5, FATAL)];
    expect(failuresAfter(rows, 0).map((r) => r.id)).toEqual([1, 3, 5]);
    expect(failuresAfter(rows, 3).map((r) => r.id)).toEqual([5]);
    expect(failuresAfter(rows, 5)).toEqual([]);
  });
});

describe("matching a failed message to what the site sent", () => {
  const id = "a584b11f-06a2-44e2-bf2f-742c696e23db";
  const owner = `إعلانك تنشر في مازد إيمو: https://www.mazed.immo/ar/annonces/${id}\nباش تحذفو: https://www.mazed.immo/ar/gerer/abcDEF_-123\nأي سؤال: +216 58 415 521`;

  it("finds the annonce of an owner's SMS by its private link", () => {
    expect(ownerSmsListing(owner)).toBe(id);
  });

  it("does not take an ordinary notification SMS for an owner's", () => {
    expect(ownerSmsListing(`Mazed Immo\nVotre annonce est en ligne\nhttps://www.mazed.immo/fr/annonces/${id}`)).toBeNull();
    expect(ownerSmsListing("https://www.mazed.immo/fr/gerer/x without an annonce")).toBeNull();
  });

  it("finds a notification's SMS by the link it ends with", () => {
    const text = `Mazed Immo\nVotre annonce est en ligne\nhttps://www.mazed.immo/fr/annonces/${id}`;
    expect(smsCarriesLink(text, `/annonces/${id}`)).toBe(true);
    expect(smsCarriesLink(text, "/annonces/other")).toBe(false);
    expect(smsCarriesLink(text, null)).toBe(false);
    expect(smsCarriesLink(text, "/")).toBe(false);
  });

  it("reads a number the way WinSMS lists it", () => {
    expect(digitsOf("+216 22 906 937")).toBe("21622906937");
  });
});
