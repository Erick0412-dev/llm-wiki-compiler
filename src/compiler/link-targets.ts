/**
 * The wikilink targets a page may use, given to every page prompt in a compile.
 *
 * Page generation runs in parallel and all pages are written in one batch at
 * the end, so without this list a page never sees the titles of the pages
 * written alongside it and guesses link targets, which then fail to resolve.
 * The list is the same for every page in a compile (this compile's concepts
 * first, then existing pages, each sorted), so it adds no per-page variation
 * to the prompt. It is capped so a large wiki cannot crowd out the source.
 */

import type { MergedConcept } from "./types.js";
import { buildTitleIndex } from "./resolver.js";

/** Maximum characters of link-target titles offered to one page prompt. */
export const LINK_TARGET_BUDGET_CHARS = 8_000;

/** Sorted, de-duplicated titles, case-insensitively unique. */
function uniqueSorted(titles: Iterable<string>, seen: Set<string>): string[] {
  const kept: string[] = [];
  for (const title of [...titles].sort((a, b) => a.localeCompare(b))) {
    const key = title.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(title.trim());
  }
  return kept;
}

/**
 * Titles pages in this compile may link to: every concept being generated now,
 * then every existing page, within {@link LINK_TARGET_BUDGET_CHARS}.
 * @param root - Project root, whose `wiki/concepts` pages supply existing titles.
 * @param merged - The concepts this compile generates pages for.
 * @returns Titles in a stable order, identical for every page in the compile.
 */
export async function buildLinkTargets(root: string, merged: readonly MergedConcept[]): Promise<string[]> {
  const seen = new Set<string>();
  const current = uniqueSorted(merged.map((entry) => entry.concept.concept), seen);
  const existing = uniqueSorted((await buildTitleIndex(root)).map((page) => page.title), seen);
  const targets: string[] = [];
  let used = 0;
  for (const title of [...current, ...existing]) {
    if (used + title.length > LINK_TARGET_BUDGET_CHARS) break;
    targets.push(title);
    used += title.length;
  }
  return targets;
}
