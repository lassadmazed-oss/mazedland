/**
 * « Demander le prix » (0222): on an annonce « Prix sur demande », a signed-in
 * buyer asks the price; the seller answers with it — it reaches the buyer in
 * the site and by SMS — or marks the question handled (he called the buyer).
 *
 * The rules the API, the pages and the tests share. No server import: the
 * annonce page's form reads them too.
 */
import { num } from "@/lib/listings/input";

export type QuestionStatus = "open" | "answered" | "done";
export type QuestionAction = "answer" | "done";

export const QUESTION_ACTIONS: readonly QuestionAction[] = ["answer", "done"];
/** The buyer's word to the seller, as long as a visit request's. */
export const QUESTION_MESSAGE_MAX = 600;

export function asQuestionStatus(v: unknown): QuestionStatus {
  return v === "answered" || v === "done" ? v : "open";
}

/**
 * Whether this annonce takes the question: online and « sur demande ». An
 * annonce with a price shows it, and a buyer who wants it lower negotiates.
 */
export function takesQuestions(l: { status: string | null; price_on_request: boolean | null }): boolean {
  return l.status === "published" && l.price_on_request === true;
}

/** Only the seller's side moves a question, and only while it waits. */
export function nextQuestionStatus(status: QuestionStatus, action: QuestionAction): QuestionStatus | null {
  if (status !== "open") return null;
  return action === "answer" ? "answered" : "done";
}

/** The price a seller answers with: a figure above zero that a property can have, in TND. */
export function answerPrice(v: unknown): number | null {
  const n = num(typeof v === "string" ? v.replace(/[\s  ]/g, "") : v);
  return n != null && n > 0 ? n : null;
}

/** The buyer's word, trimmed to what the column keeps; nothing typed is null. */
export function questionMessage(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim();
  return m ? m.slice(0, QUESTION_MESSAGE_MAX) : null;
}
