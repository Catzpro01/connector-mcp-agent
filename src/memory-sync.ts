import { existsSync, mkdirSync, readFileSync, readdirSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { LOCAL_DISK_DIR } from "./agent-name.js";
import { CliConfig } from "./config.js";
import { getKnowledgeGraph } from "./api.js";
import { clientPolicy } from "./agent-policy.js";

export interface MemoryImportResult {
  success: boolean;
  entityCount: number;
  relationCount: number;
  localPath: string;
}

/**
 * Mengimpor memori knowledge graph dari VPS ke disk sesi lokal secara senyap di latar belakang.
 */
export async function importProjectMemorySilent(
  cfg: CliConfig,
  project: string,
  agentName: string = "agent"
): Promise<MemoryImportResult> {
  const sessionDir = join(LOCAL_DISK_DIR, "sessions", project);
  const memDir = join(sessionDir, "memory");
  mkdirSync(memDir, { recursive: true });

  const policy = clientPolicy.getPolicy();
  const allowWarmup = policy.cacheWarmup ?? true;
  if (!allowWarmup) {
    return {
      success: true,
      entityCount: 0,
      relationCount: 0,
      localPath: memDir,
    };
  }

  try {
    // 1. Ambil snapshot memori VPS
    const graph = await getKnowledgeGraph(cfg, project);
    const entityCount = graph.entities ? graph.entities.length : 0;
    const relationCount = graph.relations ? graph.relations.length : 0;

    // 2. Tulis file JSON memori di disk lokal
    const jsonPath = join(memDir, "knowledge-graph.json");
    writeFileSync(jsonPath, JSON.stringify(graph, null, 2), "utf8");

    // 3. Buat rangkuman Markdown bersih yang mudah dibaca agen
    const mdLines: string[] = [
      `# 🧠 Ringkasan Pengetahuan & Memori — ${project}`,
      `*Konteks aktif untuk agen: ${agentName}*\n`,
      `## 📊 Status Memori`,
      `- Entitas Terdaftar: ${entityCount}`,
      `- Relasi Terhubung: ${relationCount}\n`,
      `## 🏷️ Entitas Terdaftar`,
    ];

    if (entityCount === 0) {
      mdLines.push(`*(Belum ada entitas. Gunakan 'learn <nama> <tipe> <observasi>' saat menemukan fakta arsitektur baru.)*`);
    } else {
      for (const ent of graph.entities) {
        mdLines.push(`### • \`${ent.name}\` (${ent.entityType || "service"})`);
        if (ent.observations && ent.observations.length > 0) {
          for (const obs of ent.observations) {
            mdLines.push(`  - ${obs}`);
          }
        }
      }
    }

    if (relationCount > 0) {
      mdLines.push("\n## 🔗 Relasi Komponen");
      for (const rel of graph.relations) {
        mdLines.push(`- ${rel.from} ──[${rel.relationType}]──▶ ${rel.to}`);
      }
    }
    mdLines.push("");

    writeFileSync(join(memDir, "MEMORY_SNAPSHOT.md"), mdLines.join("\n"), "utf8");

    // 4. Multi-tier background sync (Git + Syncthing + HTTP Fallback)
    runMultiTierSync(cfg, project, agentName);

    return {
      success: true,
      entityCount,
      relationCount,
      localPath: memDir,
    };
  } catch (err: any) {
    return {
      success: false,
      entityCount: 0,
      relationCount: 0,
      localPath: memDir,
    };
  }
}

/**
 * Multi-Tier Silent Sync Cascade:
 * - Tier 1: Syncthing REST API scan (P2P Local Daemon)
 * - Tier 2: Direct HTTP REST Server Push (Jika Syncthing offline/unreachable)
 * - Tier 3: Git Version Control Auto-Commit & Silent Push
 */
export async function runMultiTierSync(
  cfg: CliConfig,
  project: string,
  agentName: string = "agent"
): Promise<void> {
  const policy = clientPolicy.getPolicy();
  const sessionDir = join(LOCAL_DISK_DIR, "sessions", project);
  const memDir = join(sessionDir, "memory");

  // ---- TIER 1: Syncthing REST API Trigger ----
  let syncthingOk = false;
  if (policy.peerSync ?? true) {
    syncthingOk = await runSilentSyncthingScan(project);
  }

  // ---- TIER 2: Direct HTTP REST Server Push (Fallback jika Syncthing offline) ----
  if (!syncthingOk && (policy.cacheWarmup ?? true)) {
    await runSilentHttpPushFallback(cfg, project, memDir);
  }

  // ---- TIER 3: Git Version Control Tracking ----
  if (policy.backgroundBackup ?? true) {
    runSilentGitBackup(sessionDir, agentName);
  }
}

/**
 * Tier 1: Memicu pemindaian Syncthing lewat REST API lokal.
 * Mengembalikan true jika Syncthing aktif di port 8384.
 */
async function runSilentSyncthingScan(project: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);

    const res = await fetch(`http://127.0.0.1:8384/rest/db/scan?folder=${encodeURIComponent(project)}`, {
      method: "POST",
      signal: controller.signal,
    }).catch(() => null);

    clearTimeout(timer);
    return res !== null && res.ok;
  } catch {
    return false;
  }
}

/**
 * Tier 2: Fallback direct push ke server MCP jika Syncthing offline.
 * Membaca knowledge-graph.json dan file markdown lokal lalu mengirimkannya via HTTP POST.
 */
async function runSilentHttpPushFallback(cfg: CliConfig, project: string, memDir: string): Promise<void> {
  try {
    let graphData = null;
    const kgFile = join(memDir, "knowledge-graph.json");
    if (existsSync(kgFile)) {
      try {
        graphData = JSON.parse(readFileSync(kgFile, "utf8"));
      } catch {}
    }

    const filesData: Record<string, string> = {};
    if (existsSync(memDir)) {
      const entries = readdirSync(memDir);
      for (const f of entries) {
        if (f.endsWith(".md") || f.endsWith(".txt")) {
          try {
            filesData[f] = readFileSync(join(memDir, f), "utf8");
          } catch {}
        }
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);

    await fetch(`${cfg.url}/api/projects/${encodeURIComponent(project)}/memory/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { "X-API-Key": cfg.apiKey } : {}),
        ...(cfg.agentName ? { "X-Agent-Name": cfg.agentName } : {}),
      },
      body: JSON.stringify({ graph: graphData, files: filesData }),
      signal: controller.signal,
    }).catch(() => null);

    clearTimeout(timer);
  } catch {
    // Senyap sepenuhnya
  }
}

/**
 * Tier 3: Commit Git senyap di disk sesi lokal.
 */
function runSilentGitBackup(sessionDir: string, agentName: string): void {
  try {
    if (!existsSync(join(sessionDir, ".git"))) {
      spawnSync("git", ["init", "-q", "-b", "main"], { cwd: sessionDir, stdio: "ignore", windowsHide: true });
      spawnSync("git", ["config", "user.name", agentName || "developer"], { cwd: sessionDir, stdio: "ignore", windowsHide: true });
      spawnSync("git", ["config", "user.email", "dev@users.noreply.github.com"], { cwd: sessionDir, stdio: "ignore", windowsHide: true });
    }
    spawnSync("git", ["add", "memory/"], { cwd: sessionDir, stdio: "ignore", windowsHide: true });
    spawnSync(
      "git",
      ["commit", "-q", "-m", "chore: update workspace snapshot"],
      { cwd: sessionDir, stdio: "ignore", windowsHide: true }
    );
  } catch {
    // Senyap sepenuhnya
  }
}

/**
 * Background Automatic Watcher:
 * Memantau direktori sesi project secara realtime. Setiap ada file yang dibuat/diedit,
 * menjalankan multi-tier sync otomatis dengan debounce 1.2 detik.
 * Dijalankan dengan unref() sehingga tidak menghalangi proses keluar dan 100% senyap.
 */
export function startSilentAutoSyncWatcher(
  cfg: CliConfig,
  project: string,
  agentName: string = "agent"
): () => void {
  const sessionDir = join(LOCAL_DISK_DIR, "sessions", project);
  mkdirSync(sessionDir, { recursive: true });

  let debounceTimer: NodeJS.Timeout | null = null;
  let watcher: FSWatcher | null = null;

  try {
    watcher = watch(sessionDir, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      const fn = String(filename);
      // Abaikan file internal agar tidak loop
      if (fn.startsWith(".git") || fn.includes(".flight_recorder") || fn.includes(".audit") || fn.includes("node_modules")) {
        return;
      }

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        runMultiTierSync(cfg, project, agentName).catch(() => {});
      }, 1200);

      if (debounceTimer.unref) {
        debounceTimer.unref();
      }
    });

    if (watcher && (watcher as any).unref) {
      (watcher as any).unref();
    }
  } catch {
    // Jika fs.watch gagal (misal permission), engine fallback ke periodic sync senyap
    const interval = setInterval(() => {
      runMultiTierSync(cfg, project, agentName).catch(() => {});
    }, 15000);
    if (interval.unref) interval.unref();

    return () => clearInterval(interval);
  }

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (watcher) {
      try { watcher.close(); } catch {}
    }
  };
}
