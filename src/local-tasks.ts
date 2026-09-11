import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { LOCAL_DISK_DIR } from "./agent-name.js";

export type LocalTaskStatus = "running" | "exited" | "unknown";

export interface LocalTask {
  id: string;
  name: string;
  command: string;
  startedAt: string;
  status: LocalTaskStatus;
  exit: number | null;
  logPath: string;
}

interface LocalTaskMeta {
  id: string;
  name?: string;
  command: string;
  startedAt: string;
  exit: number | null;
  pid?: number;
}

let counter = 0;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Local Tasks are the agent's own "tabs" on its machine: background commands
 * tracked persistently in the Local Disk, attachable by later CLI runs and
 * later agent sessions on this machine (ADR 0012).
 */
export class LocalTaskManager {
  constructor(
    private readonly dir: string = join(LOCAL_DISK_DIR, "tasks"),
    private readonly maxTasks: number = 50,
  ) {}

  pruneRetention(maxAllowed: number = this.maxTasks): number {
    const all = this.list();
    if (all.length <= maxAllowed) return 0;
    const candidates = all
      .filter((t) => t.status === "exited" || t.status === "unknown")
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    let deletedCount = 0;
    for (const task of candidates) {
      if (this.list().length <= maxAllowed) break;
      if (this.delete(task.id)) {
        deletedCount++;
      }
    }
    return deletedCount;
  }

  start(command: string, cwd: string, tabName?: string): LocalTask {
    mkdirSync(this.dir, { recursive: true });
    this.pruneRetention(this.maxTasks - 1);
    const id = `lt-${Date.now().toString(36)}-${(counter++).toString(36)}`;
    const name = tabName?.trim() || id;
    const logPath = join(this.dir, `${id}.log`);
    const exitFile = join(this.dir, `${id}.exit`);
    const isWin = process.platform === "win32";
    let shellCmd = isWin ? "cmd.exe" : "sh";
    let shellArgs: string[];

    if (isWin) {
      const gitSh = "C:\\Program Files\\Git\\bin\\sh.exe";
      if (existsSync(gitSh)) {
        shellCmd = gitSh;
        const posixLog = logPath.replace(/\\/g, "/");
        const posixExit = exitFile.replace(/\\/g, "/");
        shellArgs = ["-c", `(${command}) >> "${posixLog}" 2>&1; echo $? > "${posixExit}"`];
      } else {
        shellArgs = ["/d", "/s", "/c", `(${command}) >> "${logPath}" 2>&1 & echo %ERRORLEVEL% > "${exitFile}"`];
      }
    } else {
      shellArgs = ["-c", `(${command}) >> "${logPath}" 2>&1; echo $? > "${exitFile}"`];
    }

    const child = spawn(shellCmd, shellArgs, { cwd, detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    const pid = child.pid;
    child.on("error", (err) => {
      try {
        writeFileSync(logPath, `Task spawn error: ${err.message}\n`, { flag: "a" });
      } catch {}
      this.updateMeta(id, { pid: undefined, exit: 1 });
    });
    child.on("exit", (code) => {
      // Preserve a kill's recorded exit (143); otherwise record the real code.
      const current = this.readMeta(id);
      this.updateMeta(id, { pid: undefined, exit: current?.exit ?? code });
    });
    const meta: LocalTaskMeta = { id, name, command, startedAt: new Date().toISOString(), exit: null, pid };
    writeFileSync(this.metaPath(id), JSON.stringify(meta, null, 2));
    return { ...meta, name, status: "running", exit: null, logPath };
  }

  list(): LocalTask[] {
    const result: LocalTask[] = [];
    if (!existsSync(this.dir)) return result;
    for (const file of readdirSyncSafe(this.dir)) {
      if (!file.endsWith(".json")) continue;
      const meta = this.readMeta(file.replace(/\.json$/, ""));
      if (!meta) continue;
      result.push({
        ...meta,
        name: meta.name || meta.id,
        status:
          meta.exit !== null
            ? "exited"
            : meta.pid
              ? isAlive(meta.pid)
                ? "running"
                : "exited"
              : "unknown",
        logPath: join(this.dir, `${meta.id}.log`),
      });
    }
    return result;
  }

  refresh(id: string): LocalTask | undefined {
    return this.list().find((t) => t.id === id || t.name === id);
  }

  find(query: string): LocalTask | undefined {
    const q = query.trim().toLowerCase();
    const matches = this.list().filter(
      (t) => t.name.toLowerCase() === q || t.id.toLowerCase() === q || t.id.toLowerCase().startsWith(q),
    );
    if (matches.length === 0) return undefined;
    const running = matches.find((m) => m.status === "running");
    if (running) return running;
    return matches.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
  }

  output(query: string, maxBytes = 200 * 1024): string {
    const task = this.find(query);
    if (!task) return "";
    const logPath = join(this.dir, `${task.id}.log`);
    if (!existsSync(logPath)) return "";
    const raw = readFileSync(logPath);
    if (raw.length <= maxBytes) return raw.toString("utf8");
    return `... (truncated, showing last ${Math.floor(maxBytes / 1024)}KB)\n` + raw.subarray(raw.length - maxBytes).toString("utf8");
  }

  kill(query: string): LocalTask | undefined {
    const task = this.find(query);
    if (!task) return undefined;
    const meta = this.readMeta(task.id);
    if (!meta) return undefined;
    if (meta.pid) {
      try {
        process.kill(-meta.pid, "SIGTERM");
      } catch {
        try {
          process.kill(meta.pid, "SIGTERM");
        } catch {
          // Already gone.
        }
      }
      this.updateMeta(task.id, { pid: undefined, exit: 143 });
    }
    return this.find(task.id);
  }

  delete(id: string): boolean {
    let deleted = false;
    for (const ext of [".json", ".log", ".exit"]) {
      const p = join(this.dir, `${id}${ext}`);
      if (existsSync(p)) {
        try {
          unlinkSync(p);
          deleted = true;
        } catch {
          // ignore
        }
      }
    }
    return deleted;
  }

  private metaPath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private readMeta(id: string): LocalTaskMeta | null {
    const path = this.metaPath(id);
    if (!existsSync(path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as LocalTaskMeta;
      let exit = typeof parsed.exit === "number" ? parsed.exit : null;
      if (exit === null) {
        const exitPath = join(this.dir, `${id}.exit`);
        if (existsSync(exitPath)) {
          const raw = readFileSync(exitPath, "utf8").trim();
          const parsedCode = parseInt(raw, 10);
          if (!Number.isNaN(parsedCode)) {
            exit = parsedCode;
            parsed.exit = exit;
            this.updateMeta(id, { pid: undefined, exit });
          }
        }
      }
      return { ...parsed, exit };
    } catch {
      return null;
    }
  }

  private updateMeta(id: string, patch: Partial<LocalTaskMeta>): void {
    const meta = this.readMeta(id);
    if (!meta) return;
    writeFileSync(this.metaPath(id), JSON.stringify({ ...meta, ...patch }, null, 2));
  }
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export const localTasks = new LocalTaskManager();
