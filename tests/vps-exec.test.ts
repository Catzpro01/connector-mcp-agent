import { describe, expect, it } from "vitest";
import { callMcpTool } from "../src/api.js";
import { loadCliConfig } from "../src/config.js";

interface ExecRunResult {
  exit: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

describe("unrestricted vps http execution (ticket 01)", () => {
  const cfg = loadCliConfig();

  it("executes a simple bash command over pure HTTP without SSH", async () => {
    const res = await callMcpTool<ExecRunResult>(cfg, "exec.run", {
      project: "smoke-app",
      command: "echo 'pure-http-ok'",
    });

    expect(res).toBeDefined();
    expect(res.exit).toBe(0);
    expect(res.stdout).toContain("pure-http-ok");
    expect(res.stderr).toBe("");
  });

  it("captures non-zero exit code accurately from remote process", async () => {
    const res = await callMcpTool<ExecRunResult>(cfg, "exec.run", {
      project: "smoke-app",
      command: "sh -c 'exit 42'",
    });

    expect(res).toBeDefined();
    expect(res.exit).toBe(42);
  });

  it("handles piped commands and subshells with full Linux freedom", async () => {
    const res = await callMcpTool<ExecRunResult>(cfg, "exec.run", {
      project: "smoke-app",
      command: "echo 'hello world' | tr 'a-z' 'A-Z'",
    });

    expect(res).toBeDefined();
    expect(res.exit).toBe(0);
    expect(res.stdout.trim()).toBe("HELLO WORLD");
  });
});
