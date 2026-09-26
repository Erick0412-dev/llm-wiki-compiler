/**
 * @file test/resolver-code-spans.test.ts
 * @description Interlink resolution must never rewrite code.
 *
 * The resolver wraps every title mention in a `[[slug|Title]]` wikilink. Code
 * is copied verbatim by readers, so a title inside a fenced block or an inline
 * code span must stay untouched: before this guard a page about a tool named
 * "llmwiki" turned `.llmwiki/state.json` into `.[[llmwiki|llmwiki]]/state.json`
 * and put links inside shell examples. Prose mentions must still be linked.
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveAndApplyLinks } from "../src/compiler/resolver.js";
import { managedTempRoots } from "./fixtures/managed-temp-roots.js";

const roots = managedTempRoots();
afterEach(roots.cleanup);

const PAGE_FRONTMATTER = "---\ntitle: Remove Command\nsummary: s\nsources: []\n---\n\n";
const LINK = "[[llmwiki|llmwiki]]";

/** A project with an `llmwiki` target page, plus one page whose body is `body`; returns the rewritten body. */
async function resolveBody(body: string): Promise<string> {
  const root = await roots.create("resolver-code");
  await writeFile(path.join(root, "wiki/concepts/llmwiki.md"), "---\ntitle: llmwiki\nsummary: s\nsources: []\n---\n\nTarget.\n");
  const pagePath = path.join(root, "wiki/concepts/remove-command.md");
  await writeFile(pagePath, PAGE_FRONTMATTER + body);
  await resolveAndApplyLinks(root, ["remove-command"], []);
  return (await readFile(pagePath, "utf-8")).slice(PAGE_FRONTMATTER.length);
}

describe("interlink resolution leaves code untouched", () => {
  it("does not link inside a fenced code block, but links the prose around it", async () => {
    const body = "Run llmwiki first.\n\n```bash\nllmwiki rm notes.md\n```\n\nThen llmwiki again.\n";
    const after = await resolveBody(body);
    expect(after).toContain("```bash\nllmwiki rm notes.md\n```");
    expect(after).toBe(`Run ${LINK} first.\n\n\`\`\`bash\nllmwiki rm notes.md\n\`\`\`\n\nThen ${LINK} again.\n`);
  });

  it("does not link inside inline code such as a path", async () => {
    const after = await resolveBody("State lives in `.llmwiki/state.json` for llmwiki.\n");
    expect(after).toBe(`State lives in \`.llmwiki/state.json\` for ${LINK}.\n`);
  });

  it("handles tilde fences, double-backtick spans and an unclosed fence", async () => {
    const tilde = await resolveBody("~~~\nllmwiki compile\n~~~\n");
    expect(tilde).toBe("~~~\nllmwiki compile\n~~~\n");
    const doubled = await resolveBody("Use ``llmwiki `x` run`` here.\n");
    expect(doubled).toBe("Use ``llmwiki `x` run`` here.\n");
    const unclosed = await resolveBody("```\nllmwiki status\n");
    expect(unclosed).toBe("```\nllmwiki status\n");
  });
});
