import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalTaskManager } from "../src/local-tasks.js";
import { TabManager } from "../src/tab-manager.js";
import { loadCliConfig, DEFAULT_CONNECTOR_URL } from "../src/config.js";

describe("zero-config and rolling retention (Ticket 04)", () => {
  it("defaults to VPS endpoint http://your-vps-ip:3210 with zero setup prompt", () => {
    // Overriding env to simulate clean install
    const oldUrl = process.env.CONNECTOR_URL;
    delete process.env.CONNECTOR_URL;

    const cfg = loadCliConfig();
    expect(cfg.url).toBe(DEFAULT_CONNECTOR_URL);
    expect(cfg.url).toBe("http://your-vps-ip:3210");

    if (oldUrl) process.env.CONNECTOR_URL = oldUrl;
  });

  it("bounds local task store history to a maximum limit by auto-pruning oldest exited records", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conn-retention-"));
    const taskDir = join(dir, "tasks");
    mkdirSync(taskDir, { recursive: true });
    // Limit to 4 tasks maximum
    const maxTasks = 4;
    const manager = new LocalTaskManager(taskDir, maxTasks);

    // Create 4 dummy exited task metadata records directly
    for (let i = 1; i <= 4; i++) {
      const id = `lt-old-${i}`;
      const meta = {
        id,
        name: `task-${i}`,
        command: `echo ${i}`,
        startedAt: new Date(Date.now() - (10 - i) * 60000).toISOString(),
        exit: 0,
      };
      writeFileSync(join(taskDir, `${id}.json`), JSON.stringify(meta));
      writeFileSync(join(taskDir, `${id}.log`), `log ${i}`);
      writeFileSync(join(taskDir, `${id}.exit`), "0");
    }

    expect(manager.list().length).toBe(4);

    // Now start a 5th task via start() -> should prune the oldest (lt-old-1)
    manager.start("echo new-5", process.cwd(), "task-5");

    const tasksAfter = manager.list();
    expect(tasksAfter.length).toBeLessThanOrEqual(4);
    // Oldest task (lt-old-1) should have been pruned
    expect(tasksAfter.some((t) => t.id === "lt-old-1")).toBe(false);
    // Newer tasks (task-3, task-4, task-5) should still exist
    expect(tasksAfter.some((t) => t.name === "task-4")).toBe(true);
    expect(tasksAfter.some((t) => t.name === "task-5")).toBe(true);
  });

  it("cleanTabs prunes all exited tasks upon request", () => {
    const dir = mkdtempSync(join(tmpdir(), "conn-clean-"));
    const taskDir = join(dir, "tasks");
    mkdirSync(taskDir, { recursive: true });
    const manager = new LocalTaskManager(taskDir, 50);
    const tabMgr = new TabManager(manager);

    // Create 3 exited tasks and 1 running task
    for (let i = 1; i <= 3; i++) {
      const id = `lt-exit-${i}`;
      const meta = {
        id,
        name: `exited-${i}`,
        command: `echo ${i}`,
        startedAt: new Date().toISOString(),
        exit: 0,
      };
      writeFileSync(join(taskDir, `${id}.json`), JSON.stringify(meta));
      writeFileSync(join(taskDir, `${id}.exit`), "0");
    }

    const runningId = "lt-run-1";
    const runningMeta = {
      id: runningId,
      name: "running-1",
      command: "sleep 999",
      startedAt: new Date().toISOString(),
      exit: null,
      pid: process.pid, // active pid
    };
    writeFileSync(join(taskDir, `${runningId}.json`), JSON.stringify(runningMeta));

    expect(manager.list().length).toBe(4);

    const cleanedCount = tabMgr.cleanTabs();
    expect(cleanedCount).toBe(3);

    const remaining = manager.list();
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe(runningId);
  });
});
