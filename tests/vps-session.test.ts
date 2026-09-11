import { describe, expect, it } from "vitest";
import { VpsSession } from "../src/vps-session.js";

describe("interactive VPS tab session (VpsSession)", () => {
  it("initializes remote identity (user, host, cwd) from VPS over HTTP", async () => {
    const session = new VpsSession("smoke-app");
    await session.init();

    expect(session.getCurrentCwd()).toBe("/work");
    const prompt = session.getPrompt();
    expect(prompt).toContain("[VPS:container|smoke-app]");
    expect(prompt).toContain("root@");
  });

  it("formats remote display paths cleanly for prompt UX", () => {
    const session = new VpsSession("smoke-app");
    expect(session.formatDisplayPath("/work")).toBe("/work");
    expect(session.formatDisplayPath("/work/src")).toBe("/work/src");
    expect(session.formatDisplayPath("/var/lib/connector/projects/smoke-app/work")).toBe("/work");
    expect(session.formatDisplayPath("/tmp")).toBe("/tmp");
  });

  it("executes foreground commands and tracks working directory changes across HTTP calls", async () => {
    const session = new VpsSession("smoke-app");
    await session.init();

    const initialCwd = session.getCurrentCwd();

    // 1. Run standard command
    const res1 = await session.runCommand("echo vps_foreground_active");
    expect(res1.exit).toBe(0);
    expect(res1.stdout).toContain("vps_foreground_active");
    expect(session.getCurrentCwd()).toBe(initialCwd);

    // 2. Change directory in container
    const res2 = await session.runCommand("cd /tmp && pwd");
    expect(res2.exit).toBe(0);
    expect(session.getCurrentCwd()).toBe("/tmp");

    // 3. Next command must execute in the new directory
    const res3 = await session.runCommand("pwd");
    expect(res3.stdout.trim()).toBe("/tmp");

    // 4. Return to work dir
    await session.runCommand("cd /work");
    expect(session.getCurrentCwd()).toBe(initialCwd);
  });

  it("captures non-zero exit codes in foreground session without crashing", async () => {
    const session = new VpsSession("smoke-app");
    await session.init();

    const res = await session.runCommand("exit 7");
    expect(res.exit).toBe(7);
  });
});
