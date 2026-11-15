import { cache } from "react";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { BOARD_COLUMNS, type BoardRow } from "./board";

const boardLog = log.scope("brd");

/**
 * The open demandes the board may read (src/lib/requests/board.ts): active,
 * with alerts — the ones agencies already see — and not expired. Criteria
 * only: `BOARD_COLUMNS` holds no person, no note, no zone. Once per render
 * (React's cache), so the home card, the Pro page and /demandes share it.
 * Nothing on an error: the board then keeps quiet rather than break a page.
 */
export const loadOpenDemandes = cache(async (): Promise<BoardRow[]> => {
  const admin = getServiceSupabase();
  if (!admin) return [];
  const { data, error } = await admin
    .from("property_requests")
    .select(BOARD_COLUMNS)
    .eq("status", "active")
    .eq("alerts", true)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) {
    boardLog.warn("open demandes not read", error);
    return [];
  }
  return (data ?? []) as unknown as BoardRow[];
});
