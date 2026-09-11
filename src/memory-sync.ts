import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { LOCAL_DISK_DIR } from "./agent-name.js";
import { CliConfig } from "./config.js";
import { getKnowledgeGraph } from "./api.js";

export interface MemoryImportResult {
  success: boolean;
  entityCount: number;
  relationCount: number;
  localPath: string;
}

/**
 * Mengimpor memori knowledge graph dari VPS ke disk sesi lokal secara senyap di latar belakang.
 * Seluruh sinkronisasi P2P (Syncthing) dan git tracking berjalan di background
 * tanpa mengganggu atau memunculkan log teknis kepada agen agar agen fokus 100% pada pekerjaannya.
 */
export async function importProjectMemorySilent(
  cfg: CliConfig,
  project: string,
  agentName: string = "agent"
): Promise<MemoryImportResult> {
  const sessionDir = join(LOCAL_DISK_DIR, "sessions", project);
  const memDir = join(sessionDir, "memory");
  mkdirSync(memDir, { recursive: true });

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

    // 4. Background Silent Git Version Tracking (untracked by agent)
    runSilentGitBackup(sessionDir, agentName, entityCount, relationCount);

    // 5. Background Silent Syncthing P2P Sync (completely invisible to agent)
    runSilentSyncthingSync(sessionDir, project);

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
 * Menjalankan commit Git di latar belakang tanpa stdout/stderr ke terminal agen.
 */
function runSilentGitBackup(sessionDir: string, agentName: string, entities: number, relations: number): void {
  try {
    if (!existsSync(join(sessionDir, ".git"))) {
      spawnSync("git", ["init", "-q", "-b", "main"], { cwd: sessionDir, stdio: "ignore" });
      spawnSync("git", ["config", "user.name", agentName], { cwd: sessionDir, stdio: "ignore" });
      spawnSync("git", ["config", "user.email", `${agentName}@local`], { cwd: sessionDir, stdio: "ignore" });
    }
    spawnSync("git", ["add", "memory/"], { cwd: sessionDir, stdio: "ignore" });
    spawnSync(
      "git",
      ["commit", "-q", "-m", `snapshot memory (${entities} entities, ${relations} relations) [skip ci]`],
      { cwd: sessionDir, stdio: "ignore" }
    );
  } catch {
    // Senyap sepenuhnya
  }
}

/**
 * Menjalankan pemindaian & sinkronisasi Syncthing secara terisolasi dan senyap.
 * Hanya mengirimkan sinyal HTTP REST API jika daemon Syncthing aktif di port 8384.
 * TIDAK PERNAH memunculkan jendela, tab, atau proses baru agar agen tidak curiga.
 */
function runSilentSyncthingSync(sessionDir: string, project: string): void {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 600);

    fetch(`http://127.0.0.1:8384/rest/db/scan?folder=${encodeURIComponent(project)}`, {
      method: "POST",
      signal: controller.signal,
    })
      .then(() => clearTimeout(timer))
      .catch(() => {
        clearTimeout(timer);
      });
  } catch {
    // Senyap sepenuhnya
  }
}
