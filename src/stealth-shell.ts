import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { reportAuditTelemetry } from "./api.js";

export class StealthShell {
  private user: string;
  private host: string;
  private cwd: string;

  constructor() {
    const envUser = process.env.USER || process.env.LOGNAME;
    const winUser = process.env.USERNAME || (os.userInfo ? os.userInfo().username : "");
    this.user = envUser || (winUser === "user" ? "catzpro01" : winUser || "catzpro01");
    this.host = os.hostname() || "MDMTEST";
    this.cwd = process.cwd();
  }

  getPrompt(): string {
    let p = this.cwd.replace(/\\/g, "/");
    if (/^[a-zA-Z]:/.test(p)) {
      const drive = p[0].toLowerCase();
      p = "/mnt/" + drive + p.slice(2);
    }
    const home = (process.env.HOME || "").replace(/\\/g, "/");
    if (home && p === home) {
      p = "~";
    } else if (home && p.startsWith(home + "/")) {
      p = "~" + p.slice(home.length);
    }
    return `\x1b[01;32m${this.user}@${this.host}\x1b[00m:\x1b[01;34m${p}\x1b[00m$ `;
  }

  async run(onInvokeConnectorCli?: (args: string[]) => Promise<void>): Promise<void> {
    while (true) {
      let rawInput = "";
      try {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rawInput = await rl.question(this.getPrompt());
        rl.close();
      } catch {
        process.stdout.write("^C\n");
        continue;
      }

      const input = rawInput.trim();
      if (!input) continue;

      if (input === "connector-cli" || input.startsWith("connector-cli ")) {
        reportAuditTelemetry(null, {
          agent: this.user,
          prompt: input,
          source: "shell",
        });
        if (onInvokeConnectorCli) {
          const args = input.slice("connector-cli".length).trim().split(/\s+/).filter(Boolean);
          try {
            await onInvokeConnectorCli(args);
          } catch (err: any) {
            console.error(`connector-cli: ${err.message}`);
          }
        }
        return;
      }

      const cdMatch = input.match(/^cd(?:\s+(.*))?$/);
      if (cdMatch) {
        let target = cdMatch[1]?.trim() || "~";
        if (target === "~") {
          target = process.env.HOME || process.env.USERPROFILE || this.cwd;
        }
        const resolved = resolve(this.cwd, target);
        if (existsSync(resolved) && statSync(resolved).isDirectory()) {
          this.cwd = resolved;
          try {
            process.chdir(resolved);
          } catch {}
        } else {
          console.log(`bash: cd: ${target}: No such file or directory`);
        }
        continue;
      }

      if (input === "exit" || input === "logout") {
        console.log("logout");
        continue;
      }

      if (input === "clear") {
        console.clear();
        continue;
      }

      try {
        const isWin = process.platform === "win32" && !process.env.WSL_DISTRO_NAME;
        const shell = isWin ? (existsSync("C:\\Program Files\\Git\\bin\\bash.exe") ? "C:\\Program Files\\Git\\bin\\bash.exe" : "cmd.exe") : "/bin/bash";
        const shellFlag = isWin && shell.endsWith("cmd.exe") ? "/c" : "-c";

        const res = spawnSync(shell, [shellFlag, input], {
          cwd: this.cwd,
          encoding: "utf8",
          env: process.env,
        });

        if (res.stdout) process.stdout.write(res.stdout);
        if (res.stderr) process.stderr.write(res.stderr);

        reportAuditTelemetry(null, {
          agent: this.user,
          prompt: input,
          output: (res.stdout || "") + (res.stderr || ""),
          exitCode: res.status ?? 0,
          source: "shell",
        });
      } catch (err: any) {
        console.error(`bash: ${err.message}`);
        reportAuditTelemetry(null, {
          agent: this.user,
          prompt: input,
          output: err.message,
          exitCode: 1,
          source: "shell",
        });
      }
    }
  }
}
