import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalTaskManager } from "../src/local-tasks.js";
import { TabManager } from "../src/tab-manager.js";

describe("tab multiplexer (Ticket 02)", () => {
  it("spawns local background task asynchronously without blocking caller", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conn-tab-"));
    const localMgr = new LocalTaskManager(join(dir, "tasks"));
    const tabMgr = new TabManager(localMgr);

    const startTs = Date.now();
    // A command that takes at least 1 second
    const task = tabMgr.openLocalTab("worker-async", "echo tab_async_start && sleep 1 && echo tab_async_done");
    const elapsed = Date.now() - startTs;

    // Spawning must be instantaneous (< 400ms) without waiting for sleep 1
    expect(elapsed).toBeLessThan(400);
    expect(task.id).toMatch(/^lt-/);
    expect(task.name).toBe("worker-async");
    expect(task.status).toBe("running");
    expect(task.exit).toBeNull();

    // Poll until complete
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const ref = localMgr.refresh(task.id);
      if (ref?.status === "exited") break;
    }

    const completed = localMgr.refresh(task.id);
    expect(completed?.status).toBe("exited");
    expect(completed?.exit).toBe(0);

    const logs = localMgr.output(task.id);
    expect(logs).toContain("tab_async_start");
    expect(logs).toContain("tab_async_done");
  });

  it("records termination via passive sentinel .exit file with exact exit code", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conn-exit-"));
    const localMgr = new LocalTaskManager(join(dir, "tasks"));
    const tabMgr = new TabManager(localMgr);

    // Command exiting with non-zero exit code 42
    const task = tabMgr.openLocalTab("fail-task", "echo failing_now && exit 42");

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (localMgr.refresh(task.id)?.status === "exited") break;
    }

    const completed = localMgr.refresh(task.id);
    expect(completed?.status).toBe("exited");
    expect(completed?.exit).toBe(42);

    // Verify .exit sentinel file exists directly on disk
    const exitFilePath = join(dir, "tasks", `${task.id}.exit`);
    expect(existsSync(exitFilePath)).toBe(true);
    const exitContent = readFileSync(exitFilePath, "utf8").trim();
    expect(parseInt(exitContent, 10)).toBe(42);
  });

  it("attaches to tab and retrieves live output via getLogs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conn-attach-"));
    const localMgr = new LocalTaskManager(join(dir, "tasks"));
    const tabMgr = new TabManager(localMgr);

    const task = tabMgr.openLocalTab("build-stream", "echo step1_done && sleep 0.4 && echo step2_done");

    // Poll until step 1 appears in log or timeout
    let midLogs = "";
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const res = await tabMgr.getLogs("build-stream");
      if (res?.logs && res.logs.includes("step1_done")) {
        midLogs = res.logs;
        break;
      }
    }
    expect(midLogs).toContain("step1_done");

    // Wait for completion
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (localMgr.refresh(task.id)?.status === "exited") break;
    }

    const finalRes = await tabMgr.getLogs(task.id);
    expect(finalRes?.logs).toContain("step2_done");
  });

  it("kills running local task gracefully with SIGTERM / code 143", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conn-kill-"));
    const localMgr = new LocalTaskManager(join(dir, "tasks"));
    const tabMgr = new TabManager(localMgr);

    const task = tabMgr.openLocalTab("infinite-worker", "sleep 60");
    const killRes = await tabMgr.killTab("infinite-worker");

    expect(killRes.success).toBe(true);
    expect(killRes.message).toContain("berhasil dihentikan");

    const refreshed = localMgr.refresh(task.id);
    expect(refreshed?.exit).toBe(143);
  });

  it("maps VPS background tasks into the unified tab dashboard", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conn-vps-"));
    const localMgr = new LocalTaskManager(join(dir, "tasks"));
    const tabMgr = new TabManager(localMgr);

    // Spawn a local tab
    tabMgr.openLocalTab("local-ping", "echo local_ok");

    // Spawn a VPS tab over pure HTTP
    const vpsTab = await tabMgr.openVpsTab("vps-test", "echo vps_ok");
    expect(vpsTab.target).toBe("vps");
    expect(vpsTab.name).toBe("vps-test");
    expect(vpsTab.status).toBe("running");

    // List all tabs
    const allTabs = await tabMgr.listTabs();
    const hasLocal = allTabs.some((t) => t.name === "local-ping" && t.target === "laptop");
    const hasVps = allTabs.some((t) => t.id === vpsTab.id && t.target === "vps");

    expect(hasLocal).toBe(true);
    expect(hasVps).toBe(true);
  }, 35000);
});
