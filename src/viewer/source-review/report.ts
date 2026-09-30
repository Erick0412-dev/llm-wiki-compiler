/**
 * Read-only source-maintenance prototype projection. Reuses compiler freshness
 * and candidate reads; deliberately exposes no approval or regeneration action.
 * Only default concept ownership is supported. Observations are not authority.
 */
import { createHash } from "node:crypto";
import { reviewFreshness } from "./freshness.js";
import { sourceExcerptReader } from "./source-excerpts.js";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { readStateClassified } from "../../utils/state.js";
import { listCandidateIdentityPage } from "../../compiler/candidate-read.js";
import { readConfinedWikiPage } from "../../compiler/confined-wiki-read.js";
import { parseFrontmatter } from "../../utils/markdown.js";
import { isSafeFilenameComponent } from "../../profile/identity.js";
import type { ReviewCandidate } from "../../utils/types.js";
import type { FreshnessSnapshot } from "../../freshness/types.js";

const LIMIT = 100;
const TEXT_LIMIT = 80_000;

/** Digest of exact displayed inputs, not a semantic correctness assertion. */
export function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Candidate bindings are diagnostics only; ordinary CLI approval owns policy. */
function candidateChecks(candidate: ReviewCandidate, current: string | null, snapshot: FreshnessSnapshot, absent: boolean) {
  const target = targetCheck(candidate, current, absent);
  return { target, sources: sourceCheck(candidate, snapshot) };
}

/** Distinguish missing bindings, contradictory expectations and observed drift. */
function targetCheck(candidate: ReviewCandidate, current: string | null, absent: boolean): string {
  if (candidate.expectTargetAbsent) {
    if (candidate.expectedTargetHash !== undefined) return "invalid expectations";
    return absent ? "expected absence observed" : "expected absent; present or unreadable";
  }
  if (candidate.expectedTargetHash === undefined) return "not recorded";
  if (!/^[a-f0-9]{64}$/.test(candidate.expectedTargetHash)) return "invalid binding";
  return current !== null && digest(current) === candidate.expectedTargetHash ? "matches" : "changed or unreadable";
}

/** Only ENOENT is evidence of absence; unreadable/symlink targets are not absent. */
async function targetAbsent(root: string, slug: string): Promise<boolean> {
  try { await lstat(path.join(root, "wiki/concepts", `${slug}.md`)); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
}

/** Sanitized legacy records can lose unsupported keys; partial coverage is not a match. */
function sourceCheck(candidate: ReviewCandidate, snapshot: FreshnessSnapshot): string {
  const bindings = candidate.sourceStates ?? {};
  const declared = candidate.sources;
  if (Object.keys(bindings).length === 0) return "not recorded";
  const owners = Object.entries(snapshot.sources).filter(([, source]) => source.concepts.includes(candidate.slug));
  const required = new Set([...declared, ...owners.map(([file]) => file)]);
  if (!required.size || [...required].some(file => !Object.hasOwn(bindings, file))) return "incomplete bindings";
  return Object.entries(bindings).every(([file, entry]) => snapshot.sources[file]?.currentHash === entry.hash)
    ? "matches" : "changed or unavailable";
}

/** Derive contributor changes from the shared freshness snapshot. */
function pageOwners(slug: string, snapshot: FreshnessSnapshot) {
  return Object.entries(snapshot.sources).filter(([, source]) => source.concepts.includes(slug))
    .map(([file, source]) => ({ file, ...source, status: !source.exists ? "unavailable"
      : source.currentHash === source.recordedHash ? "unchanged" : "changed" }));
}

/** No inference about authorship, approval, or semantic support. */
function impactOf(owners: ReturnType<typeof pageOwners>) {
  if (!owners.length) return "Source ownership unverified";
  if (owners.every(source => !source.exists)) return "No available contributors";
  return owners.some(source => source.status !== "unchanged") ? "Source update needs review" : "Pending proposal";
}

/** Keep the complete byte digest even when the displayed text is truncated. */
function currentProjection(current: string | null, absent: boolean) {
  return { current: current?.slice(0, TEXT_LIMIT) ?? null,
    currentHash: current === null ? null : digest(current), truncated: (current?.length ?? 0) > TEXT_LIMIT,
    readStatus: absent ? "Page does not exist yet" : current === null ? "Page could not be read safely" : "readable" };
}

/** Project one page without interpreting proposed Markdown as executable HTML. */
async function projectPage(root: string, slug: string, context: {
  snapshot: FreshnessSnapshot; candidates: ReviewCandidate[]; reconciliation: string[];
  readExcerpt: ReturnType<typeof sourceExcerptReader>;
}) {
  const read = await readConfinedWikiPage(root, "wiki/concepts", slug);
  const current = "content" in read ? read.content : null;
  const absent = await targetAbsent(root, slug);
  const owners = pageOwners(slug, context.snapshot);
  const excerpts = await Promise.all(owners.slice(0, 20).map(async owner => ({ file: owner.file,
    ...await context.readExcerpt(owner.file, owner.currentHash) })));
  const candidates = context.candidates.filter(candidate => candidate.slug === slug)
    .map(candidate => ({ id: candidate.id, generatedAt: candidate.generatedAt,
      body: candidate.body.slice(0, TEXT_LIMIT), bodyHash: digest(candidate.body), truncated: candidate.body.length > TEXT_LIMIT,
      checks: candidateChecks(candidate, current, context.snapshot, absent), reasons: candidate.heldReasons }));
  const meta = current === null ? {} : parseFrontmatter(current).meta;
  return { slug, title: typeof meta.title === "string" ? meta.title : slug, owners, candidates, excerpts,
    ...currentProjection(current, absent),
    reconciliationPending: context.reconciliation.includes(slug),
    impact: impactOf(owners) };
}

/** Collect live observations on demand; no state backups, providers, or writes. */
export async function collectSourceReview(root: string) {
  const classified = await readStateClassified(root);
  const snapshot = await reviewFreshness(root, classified);
  const queue = await listCandidateIdentityPage(root, LIMIT);
  const candidates = queue.entries.map(({ fileId, candidate }) => ({ ...candidate, id: fileId })).filter(candidate => !candidate.targetEntityType
    && (!candidate.targetDirectory || candidate.targetDirectory === "concepts"));
  const changed = Object.values(snapshot.sources).filter(source =>
    !source.exists || source.currentHash !== source.recordedHash);
  const slugs = [...new Set([...changed.flatMap(source => source.concepts),
    ...candidates.map(candidate => candidate.slug)])].sort();
  const safe = slugs.filter(isSafeFilenameComponent);
  const context = { snapshot, candidates, reconciliation: classified.state.frozenSlugs ?? [],
    readExcerpt: sourceExcerptReader(root, Object.keys(snapshot.sources)) };
  const pages = [];
  for (const slug of safe.slice(0, LIMIT)) pages.push(await projectPage(root, slug, context));
  const content = { projectRoot: path.resolve(root), stateStatus: classified.status, pages, totalPages: safe.length,
    candidateTotal: queue.total, candidateShown: candidates.length,
    omittedUnsafeSlugs: slugs.length - safe.length };
  return { ...content, observedAt: new Date().toISOString(), fingerprint: digest(JSON.stringify(content)) };
}
