/**
 * Dynamic snapshot manager for the llmwiki viewer.
 *
 * Implements throttled, on-request snapshot rebuilding (Issue #272):
 *   - Atomic swap: Rebuilds via `buildViewerSnapshot` and replaces the snapshot
 *     reference atomically upon completion, so requests never observe partial state.
 *   - Mutex / in-flight dedup: Never executes two rebuilds concurrently. Requests
 *     arriving while a rebuild is in progress immediately receive the previous snapshot.
 *   - Debounce floor: Enforces a minimum interval (default 5,000 ms) between rebuilds
 *     to prevent frequent disk scans on large wikis.
 *   - Resilient fallback: If rebuilding throws an error, preserves the previous valid
 *     snapshot and logs a warning so the server remains stable.
 */

import type { ViewerSnapshot } from "./types.js";
import { buildViewerSnapshot } from "./snapshot.js";

/** Default minimum interval in milliseconds between on-request snapshot rebuilds. */
export const DEFAULT_REFRESH_INTERVAL_MS = 5_000;

/** Options for configuring the snapshot manager. */
export interface SnapshotManagerOptions {
  /** Absolute project root. When missing, dynamic refreshing is skipped. */
  root?: string;
  /** Minimum interval in ms between rebuilds. Defaults to 5000 ms. */
  refreshIntervalMs?: number;
  /** Snapshot builder function. Defaults to `buildViewerSnapshot`. */
  buildSnapshot?: (root: string) => Promise<ViewerSnapshot>;
}

export class ViewerSnapshotManager {
  private currentSnapshot: ViewerSnapshot;
  private readonly root: string | undefined;
  private readonly refreshIntervalMs: number;
  private readonly buildSnapshot: (root: string) => Promise<ViewerSnapshot>;
  private lastRebuildTime: number;
  private inFlightRebuild: Promise<ViewerSnapshot> | null = null;

  constructor(initialSnapshot: ViewerSnapshot, options: SnapshotManagerOptions = {}) {
    this.currentSnapshot = initialSnapshot;
    this.root = options.root ?? initialSnapshot.root;
    this.refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    this.buildSnapshot = options.buildSnapshot ?? buildViewerSnapshot;
    this.lastRebuildTime = Date.now();
  }

  /** Retrieve the currently held snapshot without triggering a rebuild check. */
  getCurrentSnapshot(): ViewerSnapshot {
    return this.currentSnapshot;
  }

  /**
   * Acquire a snapshot for request dispatch.
   *
   * Triggers a rebuild if the refresh interval has elapsed and no rebuild is in progress.
   * Requests arriving while a rebuild is already in flight continue using the previous
   * snapshot so concurrent traffic never stalls.
   */
  async getSnapshot(): Promise<ViewerSnapshot> {
    if (!this.root || typeof this.root !== "string") {
      return this.currentSnapshot;
    }

    const now = Date.now();
    if (now - this.lastRebuildTime < this.refreshIntervalMs) {
      return this.currentSnapshot;
    }

    if (this.inFlightRebuild !== null) {
      return this.currentSnapshot;
    }

    this.inFlightRebuild = (async () => {
      try {
        const next = await this.buildSnapshot(this.root!);
        this.currentSnapshot = next;
        this.lastRebuildTime = Date.now();
        return next;
      } catch (err) {
        console.warn("viewer snapshot rebuild failed, retaining previous snapshot:", err);
        this.lastRebuildTime = Date.now();
        return this.currentSnapshot;
      } finally {
        this.inFlightRebuild = null;
      }
    })();

    return await this.inFlightRebuild;
  }
}
