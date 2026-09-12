import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localTasks, LocalTaskManager, type LocalTask } from "./local-tasks.js";
import { callMcpTool } from "./api.js";
import { loadCliConfig } from "./config.js";
import { LOCAL_DISK_DIR } from "./agent-name.js";

function getVpsAliases(): Record<string, string> {
  const p = join(LOCAL_DISK_DIR, "vps-aliases.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveVpsAlias(id: string, name: string): void {
  const p = join(LOCAL_DISK_DIR, "vps-aliases.json");
  const aliases = getVpsAliases();
  aliases[id] = name;
  try {
    writeFileSync(p, JSON.stringify(aliases, null, 2));
  } catch {}
}

export interface UnifiedTab {
  id: string;
  name: string;
  target: "laptop" | "vps";
  command: string;
  status: "running" | "exited" | "unknown";
  exit: number | null;
  startedAt: string;
  project?: string;
  logPath?: string;
}

interface VpsTaskRecord {
  id: string;
  project: string;
  command: string;
  status: string;
  exit: number | null;
  startedAt?: string;
}

export class TabManager {
  constructor(private readonly localTaskMgr: LocalTaskManager = localTasks) {}

  /**
   * Buka Tab baru di Local Disk laptop
   */
  openLocalTab(name: string, command: string, cwd: string = process.cwd()): LocalTask {
    return this.localTaskMgr.start(command, cwd, name);
  }

  /**
   * Buka Tab baru di workspace runtime engine
   */
  async openVpsTab(name: string, command: string, project = "smoke-app"): Promise<UnifiedTab> {
    const cfg = loadCliConfig();
    interface RunBgResponse {
      task?: { id: string; command?: string };
      id?: string;
    }
    const res = await callMcpTool<RunBgResponse>(cfg, "exec.run-background", {
      project,
      command,
    });
    const taskId = res?.task?.id ?? res?.id ?? `vps-${Date.now().toString(36)}`;
    saveVpsAlias(taskId, name);
    return {
      id: taskId,
      name,
      target: "vps",
      command,
      status: "running",
      exit: null,
      startedAt: new Date().toISOString(),
      project,
    };
  }

  /**
   * Mengumpulkan seluruh tab live (Laptop + Runtime Engine)
   */
  async listTabs(): Promise<UnifiedTab[]> {
    const result: UnifiedTab[] = [];

    // 1. Ambil Local Tabs
    for (const t of this.localTaskMgr.list()) {
      result.push({
        id: t.id,
        name: t.name,
        target: "laptop",
        command: t.command,
        status: t.status,
        exit: t.exit,
        startedAt: t.startedAt,
        logPath: t.logPath,
      });
    }

    // 2. Ambil Runtime Tabs
    try {
      const cfg = loadCliConfig();
      const vpsTasks = await callMcpTool<VpsTaskRecord[]>(cfg, "exec.list", {});
      const aliases = getVpsAliases();
      if (Array.isArray(vpsTasks)) {
        for (const vt of vpsTasks) {
          result.push({
            id: vt.id,
            name: aliases[vt.id] || vt.id,
            target: "vps",
            command: vt.command,
            status: vt.status === "running" ? "running" : "exited",
            exit: vt.exit,
            startedAt: vt.startedAt || "-",
            project: vt.project,
          });
        }
      }
    } catch {
      // Abaikan jika runtime engine tidak merespons
    }

    return result;
  }

  /**
   * Ambil log atau output dari tab tertentu berdasarkan nama atau ID
   */
  async getLogs(nameOrId: string): Promise<{ tab: UnifiedTab; logs: string } | null> {
    const local = this.localTaskMgr.find(nameOrId);
    if (local) {
      const logs = this.localTaskMgr.output(local.id);
      return {
        tab: {
          id: local.id,
          name: local.name,
          target: "laptop",
          command: local.command,
          status: local.status,
          exit: local.exit,
          startedAt: local.startedAt,
          logPath: local.logPath,
        },
        logs,
      };
    }

    const all = await this.listTabs();
    const query = nameOrId.trim().toLowerCase();
    const matches = all.filter(
      (t) => t.name.toLowerCase() === query || t.id.toLowerCase() === query || t.id.toLowerCase().startsWith(query),
    );
    if (matches.length === 0) return null;
    const tab =
      matches.find((m) => m.status === "running") ||
      matches.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];

    if (tab.target === "laptop") {
      const logs = this.localTaskMgr.output(tab.id);
      return { tab, logs };
    }

    // VPS Target
    try {
      const cfg = loadCliConfig();
      interface AttachResponse {
        output?: string;
        exit?: number | null;
        status?: string;
      }
      const res = await callMcpTool<AttachResponse>(cfg, "exec.attach", { task: tab.id });
      return { tab, logs: res?.output || "(belum ada output dari runtime task)" };
    } catch (e) {
      return { tab, logs: `Gagal membaca log: ${(e as Error).message}` };
    }
  }

  /**
   * Hentikan / bunuh tab
   */
  async killTab(nameOrId: string): Promise<{ success: boolean; message: string }> {
    const local = this.localTaskMgr.find(nameOrId);
    if (local) {
      const killed = this.localTaskMgr.kill(local.id);
      return {
        success: !!killed,
        message: killed ? `Tab lokal "${local.name}" (${local.id}) berhasil dihentikan.` : `Gagal menghentikan tab ${local.id}.`,
      };
    }

    const all = await this.listTabs();
    const query = nameOrId.trim().toLowerCase();
    const matches = all.filter(
      (t) => t.name.toLowerCase() === query || t.id.toLowerCase() === query || t.id.toLowerCase().startsWith(query),
    );
    if (matches.length === 0) return { success: false, message: `Tab "${nameOrId}" tidak ditemukan.` };
    const tab =
      matches.find((m) => m.status === "running") ||
      matches.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];

    if (tab.target === "laptop") {
      const killed = this.localTaskMgr.kill(tab.id);
      return {
        success: !!killed,
        message: killed ? `Tab lokal "${tab.name}" (${tab.id}) berhasil dihentikan.` : `Gagal menghentikan tab ${tab.id}.`,
      };
    }

    // Remote/Runtime Target
    try {
      const cfg = loadCliConfig();
      await callMcpTool(cfg, "exec.kill", { task: tab.id });
      return { success: true, message: `Tab runtime "${tab.name}" (${tab.id}) berhasil dihentikan.` };
    } catch (e) {
      return { success: false, message: `Gagal menghentikan tab runtime: ${(e as Error).message}` };
    }
  }

  /**
   * Bersihkan tab yang sudah selesai/exited agar dashboard tetap bersih
   */
  cleanTabs(): number {
    let count = 0;
    for (const t of this.localTaskMgr.list()) {
      if (t.status === "exited") {
        try {
          if (this.localTaskMgr.delete(t.id)) {
            count++;
          }
        } catch {}
      }
    }
    return count;
  }
}

export const tabManager = new TabManager();
