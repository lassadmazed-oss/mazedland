import { describe, expect, it } from "vitest";
import { answerPrice, asQuestionStatus, nextQuestionStatus, questionMessage, takesQuestions, QUESTION_MESSAGE_MAX } from "./price-questions";

describe("takesQuestions", () => {
  it("is for an annonce online whose price is « sur demande »", () => {
    expect(takesQuestions({ status: "published", price_on_request: true })).toBe(true);
  });
  it("is not for a price that shows, nor for an annonce offline", () => {
    expect(takesQuestions({ status: "published", price_on_request: false })).toBe(false);
    expect(takesQuestions({ status: "draft", price_on_request: true })).toBe(false);
    expect(takesQuestions({ status: "sold", price_on_request: true })).toBe(false);
    expect(takesQuestions({ status: "published", price_on_request: null })).toBe(false);
  });
});

describe("nextQuestionStatus", () => {
  it("moves a question that waits, once", () => {
    expect(nextQuestionStatus("open", "answer")).toBe("answered");
    expect(nextQuestionStatus("open", "done")).toBe("done");
    expect(nextQuestionStatus("answered", "answer")).toBeNull();
    expect(nextQuestionStatus("done", "done")).toBeNull();
  });
});

describe("answerPrice", () => {
  it("reads the figure a seller types", () => {
    expect(answerPrice(350000)).toBe(350000);
    expect(answerPrice("350000")).toBe(350000);
    expect(answerPrice("350 000")).toBe(350000);
    expect(answerPrice("1 200")).toBe(1200);
  });
  it("refuses nothing, zero, words and a figure no property has", () => {
    expect(answerPrice("")).toBeNull();
    expect(answerPrice(0)).toBeNull();
    expect(answerPrice("-5")).toBeNull();
    expect(answerPrice("abc")).toBeNull();
    expect(answerPrice(5_000_000_000)).toBeNull();
    expect(answerPrice(null)).toBeNull();
  });
});

describe("questionMessage and asQuestionStatus", () => {
  it("trims the buyer's word and keeps it to the column's size", () => {
    expect(questionMessage("  Bonjour  ")).toBe("Bonjour");
    expect(questionMessage("   ")).toBeNull();
    expect(questionMessage(42)).toBeNull();
    expect(questionMessage("x".repeat(QUESTION_MESSAGE_MAX + 50))?.length).toBe(QUESTION_MESSAGE_MAX);
  });
  it("reads a stored status, waiting by default", () => {
    expect(asQuestionStatus("answered")).toBe("answered");
    expect(asQuestionStatus("done")).toBe("done");
    expect(asQuestionStatus("nonsense")).toBe("open");
  });
});
