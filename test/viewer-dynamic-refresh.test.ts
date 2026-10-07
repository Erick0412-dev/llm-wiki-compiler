/**
 * Dynamic on-request snapshot refresh tests for llmwiki viewer (Issue #272).
 *
 * Verifies:
 *   - No rebuild happens inside the debounce interval.
 *   - A new page appears on request after the interval has elapsed.
 *   - Concurrent requests trigger only one rebuild, and requests arriving
 *     during a rebuild continue using the previous snapshot without stalling.
 *   - Rebuild failure gracefully retains the previous valid snapshot.
 */

import { describe, expect, it, vi } from "vitest";
import path from "path";
import { setTimeout as sleep } from "timers/promises";
import { makeTempRoot } from "./fixtures/temp-root.js";
import { writePage } from "./fixtures/write-page.js";
import {
  startViewer,
  startViewerServer,
  ViewerSnapshotManager,
  DEFAULT_REFRESH_INTERVAL_MS,
} from "../src/viewer/server.js";
import { buildViewerSnapshot } from "../src/viewer/snapshot.js";
import type { ViewerSnapshot } from "../src/viewer/types.js";

function makeStubSnapshot(root: string, conceptCount: number): ViewerSnapshot {
  return {
    root,
    generatedAt: new Date().toISOString(),
    stateStatus: "ok",
    project: { title: "Test", rootName: "test-root" },
    counts: {
      concepts: conceptCount,
      queries: 0,
      sourceFiles: 0,
      pendingReviews: 0,
      compiledSources: 0,
      stale: 0,
      orphaned: 0,
    },
    index: { available: false, href: "/#/index", body: "", outgoingLinks: [] },
    recentPages: [],
    pages: [],
    sourceFilenames: [],
    graph: { nodes: [], edges: [] },
  };
}

describe("ViewerSnapshotManager unit behavior", () => {
  it("uses DEFAULT_REFRESH_INTERVAL_MS of 5000ms by default", () => {
    const snap = makeStubSnapshot("/test/root", 1);
    const mgr = new ViewerSnapshotManager(snap);
    expect(DEFAULT_REFRESH_INTERVAL_MS).toBe(5_000);
    expect(mgr.getCurrentSnapshot().counts.concepts).toBe(1);
  });

  it("does not trigger rebuild inside the refresh interval", async () => {
    const initialSnap = makeStubSnapshot("/test/root", 1);
    const updatedSnap = makeStubSnapshot("/test/root", 2);
    const builder = vi.fn().mockResolvedValue(updatedSnap);

    const mgr = new ViewerSnapshotManager(initialSnap, {
      root: "/test/root",
      refreshIntervalMs: 200,
      buildSnapshot: builder,
    });

    const s1 = await mgr.getSnapshot();
    const s2 = await mgr.getSnapshot();

    expect(builder).not.toHaveBeenCalled();
    expect(s1.counts.concepts).toBe(1);
    expect(s2.counts.concepts).toBe(1);
  });

  it("rebuilds and swaps snapshot once interval has elapsed", async () => {
    const initialSnap = makeStubSnapshot("/test/root", 1);
    const updatedSnap = makeStubSnapshot("/test/root", 5);
    const builder = vi.fn().mockResolvedValue(updatedSnap);

    const mgr = new ViewerSnapshotManager(initialSnap, {
      root: "/test/root",
      refreshIntervalMs: 50,
      buildSnapshot: builder,
    });

    expect(mgr.getCurrentSnapshot().counts.concepts).toBe(1);

    await sleep(65);
    const result = await mgr.getSnapshot();

    expect(builder).toHaveBeenCalledTimes(1);
    expect(result.counts.concepts).toBe(5);
    expect(mgr.getCurrentSnapshot().counts.concepts).toBe(5);
  });

  it("triggers only one rebuild under concurrent requests; concurrent requests use previous snapshot", async () => {
    const initialSnap = makeStubSnapshot("/test/root", 1);
    const updatedSnap = makeStubSnapshot("/test/root", 10);

    let resolveRebuild!: (snap: ViewerSnapshot) => void;
    const delayedPromise = new Promise<ViewerSnapshot>((resolve) => {
      resolveRebuild = resolve;
    });

    const builder = vi.fn().mockImplementation(() => delayedPromise);

    const mgr = new ViewerSnapshotManager(initialSnap, {
      root: "/test/root",
      refreshIntervalMs: 30,
      buildSnapshot: builder,
    });

    await sleep(40);

    // Request 1 arrives and triggers rebuild
    const p1 = mgr.getSnapshot();

    // Requests 2, 3, 4 arrive while rebuild is in progress
    const s2 = await mgr.getSnapshot();
    const s3 = await mgr.getSnapshot();
    const s4 = await mgr.getSnapshot();

    // Concurrent requests immediately get previous snapshot without blocking
    expect(s2.counts.concepts).toBe(1);
    expect(s3.counts.concepts).toBe(1);
    expect(s4.counts.concepts).toBe(1);

    // Rebuild builder was called only once
    expect(builder).toHaveBeenCalledTimes(1);

    // Now complete the in-flight rebuild
    resolveRebuild(updatedSnap);
    const s1 = await p1;

    expect(s1.counts.concepts).toBe(10);
    expect(mgr.getCurrentSnapshot().counts.concepts).toBe(10);
  });

  it("gracefully falls back to previous snapshot if rebuild throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const initialSnap = makeStubSnapshot("/test/root", 3);
    const builder = vi.fn().mockRejectedValue(new Error("disk read failure"));

    const mgr = new ViewerSnapshotManager(initialSnap, {
      root: "/test/root",
      refreshIntervalMs: 25,
      buildSnapshot: builder,
    });

    await sleep(35);
    const result = await mgr.getSnapshot();

    expect(builder).toHaveBeenCalledTimes(1);
    expect(result.counts.concepts).toBe(3);
    expect(mgr.getCurrentSnapshot().counts.concepts).toBe(3);
    expect(warnSpy).toHaveBeenCalledWith(
      "viewer snapshot rebuild failed, retaining previous snapshot:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});

describe("Viewer HTTP server dynamic refresh integration", () => {
  it("serves updated page and counts after interval on real filesystem", async () => {
    const root = await makeTempRoot("viewer-dyn-refresh-real");
    const conceptsDir = path.join(root, "wiki/concepts");
    await writePage(conceptsDir, "first", { title: "First Page" }, "Initial body");

    const viewer = await startViewer({
      root,
      host: "127.0.0.1",
      port: 0,
      refreshIntervalMs: 60,
      workflowJourneys: false,
    });

    try {
      const baseUrl = `http://${viewer.host}:${viewer.port}`;

      // Initial check
      const res1 = await fetch(`${baseUrl}/api/pages`);
      expect(res1.status).toBe(200);
      const data1 = (await res1.json()) as { counts: { concepts: number } };
      expect(data1.counts.concepts).toBe(1);

      // Add second page to disk
      await writePage(conceptsDir, "second", { title: "Second Page" }, "Second body");

      // Immediate request inside debounce interval should see initial snapshot
      const resInside = await fetch(`${baseUrl}/api/pages`);
      const dataInside = (await resInside.json()) as { counts: { concepts: number } };
      expect(dataInside.counts.concepts).toBe(1);

      // Wait past refreshIntervalMs
      await sleep(80);

      // Request after interval triggers rebuild and serves new page
      const resAfter = await fetch(`${baseUrl}/api/pages`);
      const dataAfter = (await resAfter.json()) as { counts: { concepts: number } };
      expect(dataAfter.counts.concepts).toBe(2);

      const resPage = await fetch(`${baseUrl}/api/page/concepts/second`);
      expect(resPage.status).toBe(200);
      const pageData = (await resPage.json()) as { title: string; html: string };
      expect(pageData.title).toBe("Second Page");
      expect(pageData.html).toContain("Second body");
    } finally {
      await viewer.close();
    }
  });

  it("handles concurrent HTTP requests with exactly one snapshot rebuild", async () => {
    const root = await makeTempRoot("viewer-dyn-concurrency");
    await writePage(path.join(root, "wiki/concepts"), "doc", { title: "Doc" }, "Content");

    const initialSnap = await buildViewerSnapshot(root);
    let buildCallCount = 0;

    const countingBuilder = async (r: string): Promise<ViewerSnapshot> => {
      buildCallCount += 1;
      await sleep(40);
      return buildViewerSnapshot(r);
    };

    const viewer = await startViewerServer(
      initialSnap,
      {
        host: "127.0.0.1",
        port: 0,
        refreshIntervalMs: 50,
      },
      {
        buildSnapshot: countingBuilder,
      },
    );

    try {
      const baseUrl = `http://${viewer.host}:${viewer.port}`;

      // Wait for debounce interval to pass
      await sleep(65);

      // Fire 8 concurrent HTTP requests
      const promises = Array.from({ length: 8 }, () => fetch(`${baseUrl}/api/pages`));
      const responses = await Promise.all(promises);

      for (const res of responses) {
        expect(res.status).toBe(200);
      }

      // Despite 8 concurrent requests, buildSnapshot was triggered only once
      expect(buildCallCount).toBe(1);
    } finally {
      await viewer.close();
    }
  });
});
