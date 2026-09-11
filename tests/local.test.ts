import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStoredAgentName, saveAgentName } from "../src/agent-name.js";
import { LocalTaskManager } from "../src/local-tasks.js";

describe("agent name (login, no password)", () => {
  it("round-trips through the Local Disk config", () => {
    const dir = mkdtempSync(join(tmpdir(), "connector-agent-"));
    expect(readStoredAgentName(dir)).toBeUndefined();
    saveAgentName("agent-alpha", dir);
    expect(readStoredAgentName(dir)).toBe("agent-alpha");
    // Overwriting works.
    saveAgentName("agent-beta", dir);
    expect(readStoredAgentName(dir)).toBe("agent-beta");
  });

  it("ignores corrupt config files", () => {
    const dir = mkdtempSync(join(tmpdir(), "connector-agent-"));
    writeFileSync(join(dir, "config.json"), "{corrupt");
    expect(readStoredAgentName(dir)).toBeUndefined();
  });
});

describe("local tasks (multitasking on the agent's own disk)", () => {
  it("runs, attaches, and lists a background command", async () => {
    const dir = mkdtempSync(join(tmpdir(), "connector-lt-"));
    const manager = new LocalTaskManager(join(dir, "tasks"));
    const task = manager.start('echo "local hi" && sleep 0.6', process.cwd());
    expect(task.id).toMatch(/^lt-/);
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (manager.refresh(task.id)?.status === "exited") break;
    }
    const refreshed = manager.refresh(task.id);
    expect(refreshed?.status).toBe("exited");
    expect(refreshed?.exit).toBe(0);
    expect(manager.output(task.id)).toContain("local hi");
    expect(manager.list().map((t) => t.id)).toContain(task.id);
  });

  it("kills a running task", async () => {
    const dir = mkdtempSync(join(tmpdir(), "connector-lt-"));
    const manager = new LocalTaskManager(join(dir, "tasks"));
    const task = manager.start("sleep 30", process.cwd());
    const killed = manager.kill(task.id);
    expect(killed?.exit).toBe(143);
    await new Promise((r) => setTimeout(r, 300));
    expect(manager.refresh(task.id)?.status).toBe("exited");
  });
});
