import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pairStarters, parseStarter, starterFileName, type StarterGuide } from "./starter";

/**
 * The starter guides as files, read when the console asks (never at build,
 * never by itself). The folder is named with static strings so Vercel's file
 * tracing ships it with the import route (next.config.ts says so too).
 */
export const STARTER_DIR = path.join(process.cwd(), "docs", "guides");

export function readStarterGuides(dir: string = STARTER_DIR): StarterGuide[] {
  const files = readdirSync(dir)
    .filter((name) => starterFileName(name) !== null)
    .sort()
    .map((name) => parseStarter(name, readFileSync(path.join(dir, name), "utf8")));
  return pairStarters(files);
}
