/** Shared plain-language diagnostics; version matches are never approval. */
/** Matching bytes never imply editorial approval or factual correctness. */
export function reviewMessage(candidate) {
  const warnings = [targetWarning(candidate.checks.target), sourceWarning(candidate.checks.sources)].filter(Boolean);
  if (warnings.length) return warnings.join(" ");
  return "The source versions and wiki-page checks match the proposal’s recorded expectations. You still need to review the content; this is not an approval.";
}

/** Preserve refusal-grade target problems in the always-visible explanation. */
function targetWarning(check) {
  const reasons = {
    "changed or unreadable": "the wiki page changed or could not be read",
    "expected absent; present or unreadable": "the proposal expected no wiki page, but one exists or its absence cannot be confirmed",
    "invalid expectations": "the proposal contains contradictory wiki-page expectations",
    "invalid binding": "the proposal’s saved wiki-page fingerprint is invalid",
  };
  if (Object.hasOwn(reasons, check)) return `Do not apply this proposal yet: ${reasons[check]}.`;
  if (["matches", "expected absence observed"].includes(check)) return "";
  return "This proposal is not approved. We cannot confirm it was prepared for the current wiki page.";
}

/** Source problems stay visible even when the proposal has no target binding. */
function sourceWarning(check) {
  if (check === "matches") return "";
  if (check === "changed or unavailable") return "Do not apply this proposal yet: a source changed or is unavailable. Review it against the current sources.";
  return "This proposal is not approved. We cannot confirm that it covers the current versions of all its sources.";
}
