/**
 * @file src/capability-providers/packages/leaf-binding.ts
 * @description Proves an open provider file handle is still the regular file
 * at its authorized leaf path, inside a directory that is still authorized.
 * Package-evidence custody and download custody call this at their own trust
 * seams with their own failure messages; the identity proof itself is one.
 */
import { lstat, type FileHandle } from "node:fs/promises";
import {
  assertAuthorizedProviderDirectory, type AuthorizedProviderDirectory, type AuthorizedProviderPaths,
} from "./paths.js";

/** Re-authorize the parent, then require the handle and the leaf to share one inode. */
export async function assertBoundProviderLeaf(
  paths: AuthorizedProviderPaths,
  directory: AuthorizedProviderDirectory,
  leaf: string,
  handle: FileHandle,
  escaped: string,
): Promise<void> {
  await assertAuthorizedProviderDirectory(paths, directory);
  const [opened, current] = await Promise.all([handle.stat(), lstat(leaf)]);
  if (!opened.isFile() || !current.isFile() || current.isSymbolicLink()
    || opened.dev !== current.dev || opened.ino !== current.ino) {
    throw new Error(escaped);
  }
}
