/**
 * Disposable, synthetic source-update scenario using real compiler state and
 * candidate files. No model calls: proposed prose is an explicitly authored
 * fixture, not evidence that generation quality has been measured.
 */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { digest } from "../../src/viewer/source-review/report.js";

/** Seed only a newly allocated scratch project; never overwrite a user project. */
export async function createDemo(withProposal = true) {
  const root = await mkdtemp(path.join(tmpdir(), "llmwiki-source-review-"));
  for (const dir of ["sources/api", "wiki/concepts", ".llmwiki/candidates"]) {
    await mkdir(path.join(root, dir), { recursive: true });
  }
  const before = "Requests time out after 30 seconds. Streaming is exempt.\n";
  const after = "Requests time out after 60 seconds. Streaming is exempt.\n";
  const secondary = "Retry once after a timeout.\n";
  const page = "---\ntitle: Request timeouts\nsummary: Timeout and retry policy\nsources: [api/timeouts.md, retry.md]\n---\n# Request timeouts\n\nRequests time out after **30 seconds**. Streaming is exempt.\n\nRetry once after a timeout.\n";
  const source = (text: string) => ({ hash: digest(text), concepts: ["request-timeouts"],
    compiledAt: "2026-09-25T12:00:00Z" });
  const state = { version: 1, indexHash: "", sources: {
    "api/timeouts.md": source(before), "retry.md": source(secondary) } };
  const candidate = { id: "timeout-proposal", title: "Request timeouts", slug: "request-timeouts",
    summary: "Timeout updated; streaming exception retained", sources: Object.keys(state.sources),
    body: page.replace("30 seconds", "60 seconds"), generatedAt: "2026-09-26T12:00:00Z",
    reviewMode: "forced", heldReasons: [{ code: "manual-review-requested" }],
    expectedTargetHash: digest(page), sourceStates: {
      "api/timeouts.md": source(after), "retry.md": source(secondary) } };
  const files: Record<string, string> = { "sources/api/timeouts.md": after, "sources/retry.md": secondary,
    "wiki/concepts/request-timeouts.md": page, ".llmwiki/state.json": JSON.stringify(state),
    ".llmwiki/config.json": JSON.stringify({ version: 1, sources: { recursive: true } }) };
  if (withProposal) files[".llmwiki/candidates/timeout-proposal.json"] = JSON.stringify(candidate);
  for (const [file, body] of Object.entries(files)) await writeFile(path.join(root, file), body);
  return root;
}
