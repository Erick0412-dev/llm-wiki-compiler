/**
 * @file scripts/mcp-manifest.mjs
 * @description Emit version-matched MCP Registry metadata (server.json) from the
 * standard package manifest. Run after selecting the release version; registry
 * publication requires that the SAME npm version is already published and that
 * its package.json carries the matching `mcpName`. This command only generates
 * metadata and never publishes. It fails closed when the package manifest cannot
 * support a correct registry entry, so a half-configured release cannot emit a
 * plausible-looking server.json.
 *
 * The emitted shape is validated against the pinned registry schema by
 * `test/agent-discovery.test.ts`; keep the two in step when changing fields.
 */
import { readFileSync } from "node:fs";

/** Registry cap on the human-readable description (schema `maxLength`). */
const MAX_REGISTRY_DESCRIPTION_CHARS = 100;
const REGISTRY_SCHEMA = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
const SERVER_DESCRIPTION = "Compile documents into a cited knowledge wiki. Retrieve evidence, query, and review via local MCP.";
const AGENT_GUIDE_URL = "https://llmwiki.atomicstrata.ai/guides/mcp-agent-integration";

const REGISTRY_NAME = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;
const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The registry binds the entry to this name; it must exist in the published npm package.json. */
function assertRegistryName(pkg) {
  if (typeof pkg.mcpName === "string" && REGISTRY_NAME.test(pkg.mcpName)) return;
  throw new Error("package.json mcpName must be a reverse-DNS registry name such as io.github.owner/server");
}

/** Registry entries name one exact published version; ranges are rejected upstream. */
function assertExactVersion(pkg) {
  if (typeof pkg.version === "string" && EXACT_SEMVER.test(pkg.version)) return;
  throw new Error("package.json version must be an exact semantic version; registry entries cannot use ranges");
}

/** Read package.json and refuse to continue without the fields the registry binds to. */
function loadPackageManifest() {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assertRegistryName(pkg);
  assertExactVersion(pkg);
  if (SERVER_DESCRIPTION.length > MAX_REGISTRY_DESCRIPTION_CHARS) {
    throw new Error(`registry description exceeds ${MAX_REGISTRY_DESCRIPTION_CHARS} characters`);
  }
  return pkg;
}

/** Build the registry entry: one npm package run through npx, stdio transport, explicit --root. */
function buildRegistryManifest(pkg) {
  return {
    $schema: REGISTRY_SCHEMA,
    name: pkg.mcpName,
    title: "llmwiki",
    description: SERVER_DESCRIPTION,
    version: pkg.version,
    websiteUrl: AGENT_GUIDE_URL,
    repository: { url: "https://github.com/atomicstrata/llm-wiki-compiler", source: "github" },
    packages: [{
      registryType: "npm",
      identifier: pkg.name,
      version: pkg.version,
      runtimeHint: "npx",
      transport: { type: "stdio" },
      packageArguments: [
        { type: "positional", value: "serve" },
        {
          type: "named", name: "--root", format: "filepath", isRequired: true,
          placeholder: "/absolute/path/to/wiki-project",
          description: "Absolute path to the llmwiki project the user wants this server to expose.",
        },
      ],
    }],
  };
}

process.stdout.write(`${JSON.stringify(buildRegistryManifest(loadPackageManifest()), null, 2)}\n`);
