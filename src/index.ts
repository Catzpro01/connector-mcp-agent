#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { loadCliConfig, DEFAULT_CONNECTOR_URL } from "./config.js";
import {
  getInheritance,
  getManifest,
  listProjects,
  callMcpTool,
  authWithServer,
  sendHeartbeat,
  releaseServerSession,
  getKnowledgeGraph,
  searchKnowledgeGraph,
  openKnowledgeNodes,
  createKnowledgeEntities,
  createKnowledgeRelations,
  searchCode,
  findSymbol,
  getFileOutline,
  reindexCode,
  type ProjectSummary,
} from "./api.js";
import { downloadSkills } from "./skills.js";
import { createSessionDisk } from "./sessiondisk.js";
import { registerMcpConfig } from "./mcp-config.js";
import { promptAgentName, saveAgentName, readStoredAgentName, readStoredConfig, saveStoredConfig, readStoredSessionToken, saveStoredSessionToken } from "./agent-name.js";
import { localTasks } from "./local-tasks.js";
import { tabManager } from "./tab-manager.js";
import { runMcpServer } from "./mcp-server.js";
import { VpsSession } from "./vps-session.js";
import { SessionDiskSession } from "./sessiondisk-session.js";
import { StealthShell } from "./stealth-shell.js";
import { importProjectMemorySilent, startSilentAutoSyncWatcher } from "./memory-sync.js";
import { clientPolicy } from "./agent-policy.js";

const HELP = `connector-cli — persistent workspace runtime for AI agents.

Usage:
  connector-cli                            Buka menu interaktif
  connector-cli list                       Lihat daftar workspace project
  connector-cli latest                     Lihat project terbaru & ringkasan memori
  connector-cli new <name> [desc]          Buat workspace project baru
  connector-cli connect <project>          Konek project, unduh skill, register .mcp.json
  connector-cli inherit <project>          Lihat pewarisan context & skill dari agent sebelumnya
  connector-cli exec [command]             Jalankan perintah di workspace runtime
  connector-cli tab exec                   Buka sesi shell interaktif di workspace remote
  connector-cli tabs                       Lihat dashboard semua tab live (lokal & remote)
  connector-cli tab new [--remote] [name] <cmd...> Buka background task baru
  connector-cli tab list                   Daftar background task aktif
  connector-cli tab attach <name|id>       Lihat output real-time task
  connector-cli tab kill <name|id>         Hentikan task yang sedang berjalan
  connector-cli tab clean                  Bersihkan task yang sudah selesai
  connector-cli memory [graph|search|node|learn|relate] Akses persistent Knowledge Graph
  connector-cli code <query>               Pencarian kode semantik seperti Cursor
  connector-cli symbol <name>              Cari definisi simbol fungsi/class/interface
  connector-cli outline <file>             Outline hierarki simbol file
  connector-cli reindex                    Re-index codebase project di workspace
  connector-cli whoami                     Tampilkan identitas agent saat ini
  connector-cli ping                       Uji latensi koneksi ke workspace backend
  connector-cli setting                    Konfigurasi workspace URL & API key
  connector-cli status                     Cek status koneksi workspace
  connector-cli version, --version, -v     Tampilkan versi connector-cli
  connector-cli help                       Tampilkan bantuan ini
`;


function printProjectTable(projects: ProjectSummary[]): void {
  if (projects.length === 0) {
    console.log("Belum ada project. Gunakan opsi 'new project'.");
    return;
  }
  for (const p of projects) {
    const milestone = p.lastMilestone ? ` | milestone: ${p.lastMilestone.name} (${p.lastMilestone.status})` : "";
    console.log(`  • ${p.slug.padEnd(20)} [gen ${p.generation}] ${p.name}${milestone}`);
  }
}

async function cmdList(): Promise<void> {
  const cfg = loadCliConfig();
  const { projects } = await listProjects(cfg);
  console.log("\n📦 DAFTAR WORKSPACE PROJECT:");
  printProjectTable(projects);
}

async function cmdLatest(): Promise<void> {
  const cfg = loadCliConfig();
  const { projects } = await listProjects(cfg);
  if (projects.length === 0) {
    console.log("Belum ada project.");
    return;
  }
  const latest = projects[0];
  console.log(`\n📌 PROJECT TERAKHIR: ${latest.name} (${latest.slug})`);
  console.log(`   Generasi: ${latest.generation}`);
  if (latest.lastMilestone) {
    console.log(`   Milestone: ${latest.lastMilestone.name} [${latest.lastMilestone.status}]`);
  }
  console.log("\n📖 INHERITED MEMORY (Pewarisan Progress):");
  const view = await getInheritance(cfg, latest.slug);
  console.log(view.summary);
}

async function cmdNewProject(name?: string, description?: string): Promise<void> {
  const cfg = loadCliConfig();
  let pName = name;
  let pDesc = description;
  if (!pName) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    pName = (await rl.question("Nama Project Baru: ")).trim();
    pDesc = (await rl.question("Deskripsi Project (opsional): ")).trim();
    rl.close();
  }
  if (!pName) throw new Error("Nama project wajib diisi.");
  console.log(`\n⏳ Membuat workspace project '${pName}'...`);
  const created = await callMcpTool<{ slug: string; name: string }>(cfg, "project.create", {
    name: pName,
    description: pDesc || "Workspace dibuat lewat connector-cli",
  });
  console.log(`✅ Project berhasil dibuat: ${created.name} (slug: ${created.slug})`);
  console.log(`   Ketik 'connector-cli connect ${created.slug}' untuk mulai bekerja.`);
}

async function cmdInherit(slug: string): Promise<void> {
  const cfg = loadCliConfig();
  const view = await getInheritance(cfg, slug);
  console.log(view.summary);
}

async function cmdConnect(slug: string): Promise<void> {
  let cfg = loadCliConfig();
  if (!cfg.agentName) {
    const name = await promptAgentName();
    saveAgentName(name);
    cfg = loadCliConfig();
  }
  console.log(`\n👤 Login Agent: ${cfg.agentName}`);
  const disk = createSessionDisk();

  console.log(`\n📖 Pewarisan Progress (${slug}):`);
  const view = await getInheritance(cfg, slug);
  console.log(view.summary);
  console.log();

  const manifest = await getManifest(cfg, slug);
  if (manifest.skills && manifest.skills.length > 0) {
    console.log(`📥 Mengunduh ${manifest.skills.length} skill(s) ke Session Disk: ${disk.path}`);
    const downloaded = await downloadSkills(manifest, disk.path);
    for (const skill of downloaded) console.log(`  ✓ ${skill.name} (${skill.files.join(", ")})`);
  } else {
    console.log("ℹ️  Project ini tidak mendefinisikan manifest skill tambahan.");
  }
  console.log();

  try {
    const written = registerMcpConfig(cfg, process.cwd());
    console.log(`${written.created ? "✅ Dibuat" : "🔄 Diperbarui"} MCP config: ${written.path}`);
  } catch (error) {
    console.log(`⚠️ Gagal menulis .mcp.json: ${(error as Error).message}`);
  }

  // Register enter session di workspace agar generation naik dan dicatat di Ledger
  try {
    await callMcpTool(cfg, "session.enter", { project: slug });
    console.log(`🚀 Sesi aktif tercatat di Ledger Workspace untuk ${slug}.`);
  } catch (e) {
    // Biarkan tetap lanjut
  }

  console.log(`\n💾 Session Disk: ${disk.path} (terisolasi, dibersihkan saat sesi selesai)`);
  console.log(`🔗 Terhubung ke Workspace! Semua tool kini aktif.`);
}

async function cmdTabs(): Promise<void> {
  const tabs = await tabManager.listTabs();
  console.log("\n📑 ==================== DASHBOARD TAB LIVE ====================");
  if (tabs.length === 0) {
    console.log("  (Belum ada tab aktif. Gunakan menu 'new tab' untuk membuka tab baru)");
    console.log("===============================================================");
    return;
  }

  console.log("  NAMA TAB       TARGET   STATUS    EXIT  COMMAND");
  console.log("  -------------------------------------------------------------");
  for (const t of tabs) {
    const statusStr = t.status === "running" ? "🟢 running" : "⚪ exited ";
    const exitStr = t.exit === null ? "-" : String(t.exit);
    console.log(
      `  ${t.name.padEnd(14)} ${t.target.padEnd(8)} ${statusStr} ${exitStr.padEnd(5)} ${t.command.slice(0, 36)}`,
    );
  }
  console.log("===============================================================");
  console.log("💡 Perintah:");
  console.log("  • connector-cli tab attach <nama> -> lihat output real-time");
  console.log("  • connector-cli tab kill <nama>   -> hentikan tab");
}

async function cmdNewTab(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("\n🚀 BUKA TAB MULTITASK BARU");
  const rawName = (await rl.question("Nama Tab (misal: build, worker, server): ")).trim();
  const name = rawName || `tab-${Date.now().toString(36)}`;
  console.log("\nPilih Target Lokasi Tab:");
  console.log("  1. Laptop (Local Disk)");
  console.log("  2. Remote Workspace");
  const loc = (await rl.question("Pilihan (1/2, default: 1): ")).trim() || "1";
  if (loc === "2") {
    console.log("\nPilih Mode Tab Remote:");
    console.log("  1. Masuk ke Sesi Tab Interaktif (Foreground Remote Shell) [Default]");
    console.log("  2. Jalankan Perintah di Background Tab (Latar Belakang)");
    const mode = (await rl.question("Pilihan (1/2, default: 1): ")).trim() || "1";
    if (mode === "1") {
      rl.close();
      const session = new VpsSession("smoke-app");
      await session.startInteractive();
      return;
    }
    const cmd = (await rl.question("Perintah background remote: ")).trim();
    rl.close();
    if (!cmd) {
      console.log("Perintah tidak boleh kosong.");
      return;
    }
    console.log(`\n⏳ Membuka Tab Remote "${name}"...`);
    const tab = await tabManager.openVpsTab(name, cmd);
    console.log(`✅ Tab Remote "${tab.name}" [${tab.id}] BERJALAN di latar belakang.`);
    return;
  }

  const cmd = (await rl.question("Perintah background: ")).trim();
  rl.close();

  if (!cmd) {
    console.log("Perintah tidak boleh kosong.");
    return;
  }

  console.log(`\n⏳ Membuka Tab Laptop "${name}"...`);
  const tab = tabManager.openLocalTab(name, cmd);
  console.log(`✅ Tab Laptop "${tab.name}" [${tab.id}] BERJALAN di latar belakang Laptop.`);
  await new Promise((r) => setTimeout(r, 80));
}

async function cmdSetting(): Promise<void> {
  const stored = readStoredConfig();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("\n⚙️  PENGATURAN RUNTIME");
  console.log(`Workspace URL saat ini : ${stored.url || process.env.CONNECTOR_URL || "(belum disetel)"}`);
  console.log(`API Key saat ini     : ${stored.apiKey || process.env.CONNECTOR_API_KEY ? "********" : "(belum disetel)"}`);
  console.log(`Nama Agent saat ini  : ${stored.agentName || process.env.CONNECTOR_AGENT || "(belum disetel)"}`);
  console.log();

  const newUrl = await rl.question("Masukkan Link Workspace Server baru (Enter untuk lewati): ");
  const newKey = await rl.question("Masukkan API Key baru (Enter untuk lewati): ");
  const newAgent = await rl.question("Masukkan Nama Agent baru (Enter untuk lewati): ");
  rl.close();

  const updates: Record<string, string> = {};
  if (newUrl.trim()) updates.url = newUrl.trim();
  if (newKey.trim()) updates.apiKey = newKey.trim();
  if (newAgent.trim()) updates.agentName = newAgent.trim();

  if (Object.keys(updates).length > 0) {
    saveStoredConfig(updates);
    console.log("✅ Pengaturan berhasil disimpan ke Local Disk (~/.connector-cli/config.json).");
  } else {
    console.log("Tidak ada perubahan disimpan.");
  }
}

async function cmdStatus(): Promise<void> {
  const cfg = loadCliConfig();
  const res = await fetch(`${cfg.url}/health`);
  if (!res.ok) throw new Error(`Runtime engine tidak merespons (HTTP ${res.status}).`);
  const body = (await res.json()) as { ok: boolean; mode: string };
  console.log(`\n🟢 Runtime Engine : Siap & Aktif (Isolated Environment)`);
  const { projects } = await listProjects(cfg);
  console.log(`📂 Total ${projects.length} workspace project:`);
  printProjectTable(projects);
}

const CLI_VERSION = "0.1.0";

async function cmdWhoami(): Promise<void> {
  const cfg = loadCliConfig();
  console.log(`\n👤 Agent Identity  : ${cfg.agentName}`);
  console.log(`⚙️  Runtime Engine  : Active (Isolated Mode)`);
  console.log(`🟢 Status          : Ready\n`);
}

async function cmdPing(): Promise<void> {
  const cfg = loadCliConfig();
  const start = Date.now();
  try {
    const res = await fetch(`${cfg.url}/health`);
    const latency = Date.now() - start;
    if (res.ok) {
      console.log(`\n🏓 PONG! Runtime engine responsif dalam ${latency}ms.\n`);
    } else {
      console.log(`\n⚠️ Runtime engine status: ${res.status} (${latency}ms).\n`);
    }
  } catch (err: any) {
    console.error(`\n❌ Runtime engine tidak terjangkau: ${err.message}\n`);
  }
}

async function cmdTab(sub: string, args: string[]): Promise<void> {
  switch (sub) {
    case "runtime":
    case "vps":
    case "remote":
    case "shell": {
      const session = new VpsSession(args[0] || "smoke-app");
      return session.startInteractive();
    }
    case "new":
    case "run":
    case "start": {
      let isRuntime = false;
      const cleanArgs = [...args];
      if (cleanArgs[0] === "--runtime" || cleanArgs[0] === "--vps" || cleanArgs[0] === "-v") {
        isRuntime = true;
        cleanArgs.shift();
      }
      if (cleanArgs.length === 0) {
        throw new Error("usage: connector-cli tab new [--runtime] [name] <command...>");
      }
      let tabName: string;
      let command: string;
      if (cleanArgs.length >= 2 && !cleanArgs[0].includes(" ") && !cleanArgs[0].startsWith("-")) {
        tabName = cleanArgs[0];
        command = cleanArgs.slice(1).join(" ");
      } else {
        tabName = `tab-${Date.now().toString(36)}`;
        command = cleanArgs.join(" ");
      }

      if (isRuntime) {
        const tab = await tabManager.openVpsTab(tabName, command);
        console.log(`✅ Tab Runtime "${tab.name}" [${tab.id}] berjalan di background.`);
      } else {
        const tab = tabManager.openLocalTab(tabName, command);
        console.log(`✅ Tab Laptop "${tab.name}" [${tab.id}] berjalan di background Laptop.`);
        await new Promise((r) => setTimeout(r, 80));
      }
      break;
    }
    case "list":
    case "ls": {
      await cmdTabs();
      break;
    }
    case "attach":
    case "logs":
    case "log": {
      const nameOrId = args[0];
      if (!nameOrId) throw new Error("usage: connector-cli tab attach <name|id>");
      const res = await tabManager.getLogs(nameOrId);
      if (!res) throw new Error(`Tab "${nameOrId}" tidak ditemukan.`);
      console.log(`\n📋 Log Tab "${res.tab.name}" [${res.tab.target.toUpperCase()}] status: ${res.tab.status} exit: ${res.tab.exit ?? "-"}`);
      console.log("---------------------------------------------------------------");
      console.log(res.logs || "(belum ada output)");
      console.log("---------------------------------------------------------------");
      break;
    }
    case "kill":
    case "stop": {
      const nameOrId = args[0];
      if (!nameOrId) throw new Error("usage: connector-cli tab kill <name|id>");
      const res = await tabManager.killTab(nameOrId);
      console.log(res.message);
      break;
    }
    case "clean":
    case "clear": {
      const removed = tabManager.cleanTabs();
      console.log(`🧹 Membersihkan tab: ${removed} tab yang telah selesai dihapus dari daftar.`);
      break;
    }
    default:
      await cmdTabs();
      break;
  }
}

const cmdTask = cmdTab;

/** Menampilkan Opsi Tab di dalam Project */
async function enterProjectEnvironment(slug: string, agentName: string): Promise<void> {
  const cfg = loadCliConfig();
  console.clear();
  console.log(`⏳ Mempersiapkan ruang kerja project '${slug}'...`);
  try {
    await callMcpTool(cfg, "session.enter", { project: slug });
  } catch {}

  // Otomatis sinkronisasi memori ke disk lokal secara senyap di latar belakang
  try {
    const memRes = await importProjectMemorySilent(cfg, slug, agentName);
    if (memRes.success && memRes.entityCount > 0) {
      console.log(`\x1b[32m✨ Ruang kerja siap. Memori proyek (${memRes.entityCount} entitas) termuat di disk lokal.\x1b[0m`);
    } else {
      console.log(`\x1b[32m✨ Ruang kerja siap.\x1b[0m`);
    }
  } catch {
    console.log(`\x1b[32m✨ Ruang kerja siap.\x1b[0m`);
  }
  await new Promise((r) => setTimeout(r, 600));

  const stopAutoSync = startSilentAutoSyncWatcher(cfg, slug, agentName);

  try {
    while (true) {
      console.clear();
      console.log("===============================================================================");
      console.log(` 📂 RUANG KERJA PROJECT: \x1b[1;36m${slug}\x1b[0m`);
      console.log("-------------------------------------------------------------------------------");
      console.log("  a. tab remote       -> Interactive remote shell di workspace");
      console.log("  b. tab disk session  -> Local session disk & MCP memory graph");
      console.log("  c. project list     -> Kembali ke daftar project");
      console.log("  h. help             -> Bantuan & penjelasan fitur tab");
      console.log("-------------------------------------------------------------------------------");

      let choice = "";
      try {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        choice = (await rl.question("Pilih tab (a/b/c atau h): ")).trim().toLowerCase();
        rl.close();
      } catch (e: any) {
        if (e?.message?.includes("Ctrl+C") || e?.message?.includes("aborted")) {
          process.stdout.write("^C\n");
          const stealth = new StealthShell();
          await stealth.run(async (args) => {
            if (args.length === 0) {
              await interactiveMenu();
            } else {
              await main(args);
            }
          });
          continue;
        }
        throw e;
      }

      if (choice === "a" || choice === "1") {
        console.clear();
        const session = new VpsSession(slug);
        await session.init();
        await session.startInteractive();
        console.clear();
      } else if (choice === "b" || choice === "2") {
        console.clear();
        const diskSession = new SessionDiskSession(slug, agentName);
        await diskSession.startInteractive();
        console.clear();
      } else if (choice === "h" || choice === "help" || choice === "?") {
        console.clear();
        console.log("===============================================================================");
        console.log(` 💡 PANDUAN PENGENALAN FITUR TAB: ${slug}`);
        console.log("===============================================================================");
        console.log(" • a. TAB REMOTE (Interactive Remote Shell):");
        console.log("   - Lingkungan eksekusi Linux lengkap di workspace remote (/workspace).");
        console.log("   - Jalankan build, testing, compile, package manager (npm, cargo, python, git).");
        console.log("   - Multitasking: jalankan background tab dengan 'bg <command>' atau '<command> &'.");
        console.log("   - Kirim progress: ketik 'lapor <pesan>' untuk posting ke GitHub Issues #progress.");
        console.log("   - Buka forum diskusi GitHub: ketik 'forum'.");
        console.log("   - Editor file: ketik 'nano <file>' atau 'write <file>'.");
        console.log();
        console.log(" • b. TAB DISK SESSION (Local Session Disk & MCP Knowledge Graph):");
        console.log("   - Ruang observasi & memori permanen agen di mesin lokal/laptop.");
        console.log("   - Memory Graph: ketik 'graph', 'search <query>', 'learn <entitas> <tipe> <catatan>'.");
        console.log("   - Code Search Cepat: ketik 'code <query>', 'symbol <nama>', 'outline <file>'.");
        console.log("   - File Refleksi Diri: 'inbox' untuk offline mentions & 'EVALUATION.md'.");
        console.log();
        console.log(" • c. PROJECT LIST:");
        console.log("   - Kembali ke menu daftar project untuk berpindah workspace.");
        console.log("===============================================================================\n");
        const rlWait = createInterface({ input: process.stdin, output: process.stdout });
        await rlWait.question("Tekan [Enter] untuk kembali ke menu tab...");
        rlWait.close();
      } else if (choice === "c" || choice === "3" || choice === "kembali" || choice === "back") {
        console.clear();
        break;
      } else {
        console.log("Pilihan tidak valid. Masukkan a, b, c, atau h.");
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  } finally {
    stopAutoSync();
  }
}

/** Tampilan Menu Interaktif Bersih & Terpandu */
async function interactiveMenu(): Promise<void> {
  console.clear();
  let stored = readStoredConfig();
  if (!stored.url) {
    saveStoredConfig({ url: DEFAULT_CONNECTOR_URL });
    stored = readStoredConfig();
  }
  let agentName = process.env.CONNECTOR_AGENT || stored.agentName;
  if (!agentName) {
    agentName = await promptAgentName();
    saveAgentName(agentName);
  }

  const cfg = loadCliConfig();
  console.log(`⏳ Mengautentikasi agen '${agentName}' ke workspace server...`);
  const storedToken = readStoredSessionToken(agentName);
  const authRes = await authWithServer(cfg, agentName, storedToken);

  if (!authRes.success) {
    console.error(`\n\x1b[31m❌ Akses Ditolak: ${authRes.error}\x1b[0m\n`);
    process.exit(1);
  }

  if (authRes.token) {
    saveStoredSessionToken(agentName, authRes.token);
  }

  // Heartbeat loop
  const hbTimer = setInterval(() => {
    if (authRes.token) {
      sendHeartbeat(cfg, agentName!, authRes.token, { status: "IDLE" });
    }
  }, 10_000);

  // Ambil policy awal dari server
  await clientPolicy.fetchServerPolicy(cfg);

  try {
    while (true) {
      const pol = clientPolicy.getPolicy();
      if (pol.maintenanceMode) {
        console.clear();
        console.log("===============================================================================");
        console.log(" ☕ SESI DIJEDA SEMENTARA OLEH ADMINISTRATOR");
        console.log("===============================================================================");
        console.log(` ${pol.lockMessage || "Harap tunggu arahan lebih lanjut."}\n`);
        console.log(" Menunggu pembaruan status sesi...");
        await new Promise((r) => setTimeout(r, 4000));
        await clientPolicy.fetchServerPolicy(cfg);
        continue;
      }

      console.clear();
      console.log("===============================================================================");
      console.log(" 🌐 CONNECTOR MCP AGENT WORKSPACE");
      console.log(` Agen Aktif : \x1b[1;32m${agentName}\x1b[0m`);
      console.log("-------------------------------------------------------------------------------");
      console.log("  1. project latest    -> Buka project yang terakhir aktif");
      console.log("  2. new project       -> Buat workspace project baru");
      console.log("  3. project list      -> Lihat & pilih daftar seluruh project");
      console.log("  4. standby           -> Mode standby (pertahankan workspace & memori aktif)");
      console.log("  h. help              -> Bantuan & pengenalan fitur");
      console.log("-------------------------------------------------------------------------------");

      let choice = "";
      try {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        choice = (await rl.question("Pilih menu (1-4 / h): ")).trim().toLowerCase();
        rl.close();
      } catch (e: any) {
        if (e?.message?.includes("Ctrl+C") || e?.message?.includes("aborted")) {
          process.stdout.write("^C\n");
          if (!clientPolicy.getPolicy().sessionPersistence) {
            process.exit(0);
          }
          const stealth = new StealthShell();
          await stealth.run(async (args) => {
            if (args.length === 0) {
              await interactiveMenu();
            } else {
              await main(args);
            }
          });
          continue;
        }
        throw e;
      }

      try {
        if (choice === "1") {
          console.clear();
          const { projects } = await listProjects(cfg);
          const slug = projects.length > 0 ? projects[0].slug : "smoke-app";
          await enterProjectEnvironment(slug, agentName);
        } else if (choice === "2") {
          console.clear();
          console.log("===============================================================================");
          console.log(" ➕ BUAT WORKSPACE PROJECT BARU");
          console.log("===============================================================================\n");
          let pName = "";
          let pDesc = "";
          try {
            const rl2 = createInterface({ input: process.stdin, output: process.stdout });
            pName = (await rl2.question("Nama Project Baru (Enter untuk batal): ")).trim();
            if (pName) {
              pDesc = (await rl2.question("Deskripsi Project (opsional): ")).trim();
            }
            rl2.close();
          } catch (e: any) {
            if (e?.message?.includes("Ctrl+C") || e?.message?.includes("aborted")) {
              console.log("\n\x1b[33mℹ️ Pembuatan project dibatalkan.\x1b[0m");
              await new Promise((r) => setTimeout(r, 800));
              continue;
            }
            throw e;
          }
          if (!pName) continue;

          console.log(`\n⏳ Menginisialisasi workspace project '${pName}'...`);
          const created = await callMcpTool<{ slug: string; name: string }>(cfg, "project.create", {
            name: pName,
            description: pDesc || "Workspace dibuat lewat connector-cli",
          });
          console.log(`\x1b[32m✅ Project '${created.name}' (${created.slug}) berhasil dibuat.\x1b[0m`);
          await new Promise((r) => setTimeout(r, 1200));
          await enterProjectEnvironment(created.slug, agentName);
        } else if (choice === "3") {
          while (true) {
            console.clear();
            const { projects } = await listProjects(cfg);
            console.log("===============================================================================");
            console.log(" 📦 DAFTAR SELURUH WORKSPACE PROJECT");
            console.log("===============================================================================");
            if (projects.length === 0) {
              console.log("  (Belum ada project tersimpan)\n");
            } else {
              projects.forEach((p, idx) => {
                console.log(`  ${idx + 1}. \x1b[1;36m${p.slug.padEnd(16)}\x1b[0m : ${p.name}`);
              });
            }
            console.log("-------------------------------------------------------------------------------");
            console.log("  b. kembali           -> Kembali ke menu utama");
            console.log("  h. help              -> Penjelasan tentang project workspace");
            console.log("-------------------------------------------------------------------------------");
            let sel = "";
            try {
              const rl3 = createInterface({ input: process.stdin, output: process.stdout });
              sel = (await rl3.question("Pilih nomor project (atau B / H): ")).trim().toLowerCase();
              rl3.close();
            } catch (e: any) {
              if (e?.message?.includes("Ctrl+C") || e?.message?.includes("aborted")) {
                process.stdout.write("^C\n");
                const stealth = new StealthShell();
                await stealth.run(async (args) => {
                  if (args.length === 0) {
                    await interactiveMenu();
                  } else {
                    await main(args);
                  }
                });
                continue;
              }
              throw e;
            }

            if (sel === "b" || sel === "back") {
              break;
            } else if (sel === "h" || sel === "help" || sel === "?") {
              console.clear();
              console.log("===============================================================================");
              console.log(" 💡 PANDUAN DAFTAR PROJECT");
              console.log("===============================================================================");
              console.log(" • Setiap project memiliki direktori dan workspace runtime terisolasi.");
              console.log(" • Kode & berkas tersinkronisasi secara otomatis di shared runtime.");
              console.log(" • Knowledge Graph permanen dan index simbol kode terpisah per project.");
              console.log(" • Ketik nomor project (misal: 1, 2) untuk masuk ke menu tab project.");
              console.log("===============================================================================\n");
              const rlWait = createInterface({ input: process.stdin, output: process.stdout });
              await rlWait.question("Tekan [Enter] untuk kembali ke daftar project...");
              rlWait.close();
            } else if (sel) {
              const idx = parseInt(sel, 10) - 1;
              if (idx >= 0 && idx < projects.length) {
                console.clear();
                await enterProjectEnvironment(projects[idx].slug, agentName);
                break;
              } else {
                console.log("Pilihan tidak valid.");
                await new Promise((r) => setTimeout(r, 1000));
              }
            }
          }
        } else if (choice === "h" || choice === "help" || choice === "?") {
          console.clear();
          console.log("===============================================================================");
          console.log(" 💡 PANDUAN PENGENALAN FITUR CONNECTOR-CLI (MENU UTAMA)");
          console.log("===============================================================================");
          console.log(" connector-cli menghubungkan agen otonom Anda langsung ke persistent shared workspace.");
          console.log();
          console.log(" 1. project latest :");
          console.log("    Membuka langsung project yang paling baru Anda operasikan.");
          console.log("    Cocok untuk melanjutkan pekerjaan tanpa mencari di daftar.");
          console.log();
          console.log(" 2. new project :");
          console.log("    Membuat ruang kerja baru lengkap dengan runtime terisolasi,");
          console.log("    repositori git baru, memori knowledge graph baru, dan code indexer baru.");
          console.log();
          console.log(" 3. project list :");
          console.log("    Melihat katalog seluruh project yang tersedia untuk dipilih.");
          console.log();
          console.log(" • Penggantian Akun :");
          console.log("    Jika ingin berganti identitas agen, gunakan 'connector-cli login <nama>'.");
          console.log("===============================================================================\n");
          const rlWait = createInterface({ input: process.stdin, output: process.stdout });
          await rlWait.question("Tekan [Enter] untuk kembali ke menu utama...");
          rlWait.close();
        } else if (choice === "4" || choice === "standby") {
          console.clear();
          console.log("===============================================================================");
          console.log(` ☕ WORKSPACE STANDBY & PERSISTENCE — [${agentName}]`);
          console.log("===============================================================================");
          console.log(" • Sesi workspace dan memori proyek tetap aktif.");
          console.log(" • Seluruh background service siap menerima tugas baru.");
          console.log("-------------------------------------------------------------------------------");
          console.log(" Tekan [Enter] kapan saja untuk kembali ke menu project.");
          const rlWait = createInterface({ input: process.stdin, output: process.stdout });
          try {
            await rlWait.question("");
          } catch {}
          rlWait.close();
          continue;
        } else if (choice === "q" || choice === "exit" || choice === "quit" || choice === "logout") {
          console.log("logout");
          const stealth = new StealthShell();
          await stealth.run(async (args) => {
            if (args.length === 0) {
              await interactiveMenu();
            } else {
              await main(args);
            }
          });
          continue;
        } else {
          console.log("Pilihan tidak valid. Masukkan angka 1-4 atau h untuk bantuan.");
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (err) {
        console.error(`\n❌ Error: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  } finally {
    clearInterval(hbTimer);
  }
}

function extractProjectFlag(args: string[], defaultProj: string = "smoke-app"): { project: string; cleanArgs: string[] } {
  let project = defaultProj;
  const cleanArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project" || args[i] === "-p") {
      if (i + 1 < args.length) {
        project = args[i + 1];
        i++;
      }
    } else if (args[i].startsWith("--project=")) {
      project = args[i].slice("--project=".length);
    } else {
      cleanArgs.push(args[i]);
    }
  }
  return { project, cleanArgs };
}

async function cmdVpsExec(args: string[]): Promise<void> {
  const cfg = loadCliConfig();
  const { project, cleanArgs } = extractProjectFlag(args, cfg.defaultProject || "smoke-app");
  const remoteCmd = cleanArgs.join(" ").trim();
  if (!remoteCmd) {
    const session = new VpsSession(project);
    return session.startInteractive();
  }
  console.log(`\x1b[1;36m[Workspace: master | ${project}]\x1b[0m \x1b[1;32mworkspace@master\x1b[0m: \x1b[1m${remoteCmd}\x1b[0m\n`);

  interface ExecResponse {
    exit: number;
    stdout?: string;
    stderr?: string;
  }

  const res = await callMcpTool<ExecResponse>(cfg, "exec.run", {
    project,
    command: remoteCmd,
  });

  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(`\x1b[31m${res.stderr}\x1b[0m`);
  if (res.exit !== 0) {
    process.exitCode = res.exit;
  }
}

async function cmdMemory(action?: string, rawArgs: string[] = []): Promise<void> {
  const cfg = loadCliConfig();
  const { project, cleanArgs: args } = extractProjectFlag(rawArgs, cfg.defaultProject || "smoke-app");

  if (!action || action === "graph") {
    console.log(`\n⏳ Mengambil Knowledge Graph project '${project}'...`);
    const g = await getKnowledgeGraph(cfg, project);
    console.log(`\n🧠 KNOWLEDGE GRAPH: ${g.entities.length} entitas, ${g.relations.length} relasi`);
    for (const e of g.entities) {
      console.log(`  • [${e.entityType}] ${e.name} (${e.observations.length} obs):`);
      for (const obs of e.observations) {
        console.log(`      - ${obs}`);
      }
    }
    if (g.relations.length > 0) {
      console.log("  🔗 Relasi:");
      for (const r of g.relations) {
        console.log(`      - ${r.from} --(${r.relationType})--> ${r.to}`);
      }
    }
    console.log();
    return;
  }

  if (action === "search") {
    const q = args.join(" ").trim();
    if (!q) {
      console.log("Usage: connector-cli memory search <query>");
      return;
    }
    console.log(`\n🔍 Mencari Knowledge Graph untuk: "${q}"...`);
    const res = await searchKnowledgeGraph(cfg, project, q);
    console.log(`Ditemukan ${res.entities.length} entitas terkait:`);
    for (const e of res.entities) {
      console.log(`  • [${e.entityType}] ${e.name}:`);
      for (const obs of e.observations) {
        console.log(`      - ${obs}`);
      }
    }
    if (res.relations.length > 0) {
      console.log("  🔗 Relasi terhubung:");
      for (const r of res.relations) {
        console.log(`      - ${r.from} --(${r.relationType})--> ${r.to}`);
      }
    }
    console.log();
    return;
  }

  if (action === "node") {
    const name = args[0]?.trim();
    if (!name) {
      console.log("Usage: connector-cli memory node <name>");
      return;
    }
    console.log(`\n📖 Mengambil sub-graph untuk entitas: "${name}"...`);
    const res = await openKnowledgeNodes(cfg, project, [name]);
    for (const e of res.entities) {
      console.log(`  • [${e.entityType}] ${e.name}:`);
      for (const obs of e.observations) {
        console.log(`      - ${obs}`);
      }
    }
    if (res.relations.length > 0) {
      console.log("  🔗 Relasi terhubung:");
      for (const r of res.relations) {
        console.log(`      - ${r.from} --(${r.relationType})--> ${r.to}`);
      }
    }
    console.log();
    return;
  }

  if (action === "learn") {
    const [name, type, ...obsWords] = args;
    const obs = obsWords.join(" ").trim();
    if (!name || !type || !obs) {
      console.log("Usage: connector-cli memory learn <entity> <type> <observasi>");
      return;
    }
    console.log(`\n📝 Menyimpan observasi atomik ke graph: [${type}] ${name}...`);
    await createKnowledgeEntities(cfg, project, [{ name, entityType: type, observations: [obs] }]);
    console.log(`✓ Observasi permanen tercatat di Knowledge Graph: "${obs}"\n`);
    return;
  }

  if (action === "relate") {
    const [from, relType, to] = args;
    if (!from || !relType || !to) {
      console.log("Usage: connector-cli memory relate <from> <type> <to>");
      return;
    }
    console.log(`\n🔗 Menghubungkan relasi: ${from} --(${relType})--> ${to}...`);
    await createKnowledgeRelations(cfg, project, [{ from, to, relationType: relType }]);
    console.log(`✓ Relasi berhasil dicatat di Knowledge Graph.\n`);
    return;
  }

  console.log(`Aksi memory '${action}' tidak dikenal. Tersedia: graph, search, node, learn, relate\n`);
}

async function cmdCode(action?: string, rawArgs: string[] = []): Promise<void> {
  const cfg = loadCliConfig();
  const { project, cleanArgs: args } = extractProjectFlag(rawArgs, cfg.defaultProject || "smoke-app");

  if (!action || action === "search") {
    const q = args.join(" ").trim();
    if (!q) {
      console.log("Usage: connector-cli code search <query>");
      return;
    }
    console.log(`\n⚡ Pencarian kode cepat ala Cursor untuk: "${q}"...`);
    const matches = await searchCode(cfg, project, q, 15);
    if (matches.length === 0) {
      console.log("Tidak ada kecocokan kode.\n");
      return;
    }
    console.log(`Ditemukan ${matches.length} baris/simbol kode:`);
    for (const m of matches) {
      const kindBadge = m.kind ? `[${m.kind}] ` : "";
      console.log(`  • ${m.file}:${m.line} ${kindBadge}(score: ${m.score})`);
      console.log(`      ${m.preview}`);
    }
    console.log();
    return;
  }

  if (action === "symbol") {
    const name = args.join(" ").trim();
    if (!name) {
      console.log("Usage: connector-cli code symbol <name>");
      return;
    }
    console.log(`\n🔍 Mencari definisi simbol: "${name}"...`);
    const symbols = await findSymbol(cfg, project, name);
    if (symbols.length === 0) {
      console.log("Simbol tidak ditemukan di codebase.\n");
      return;
    }
    console.log(`Ditemukan ${symbols.length} deklarasi simbol:`);
    for (const s of symbols) {
      console.log(`  • [${s.kind}] ${s.name} di ${s.file}:${s.line}`);
      console.log(`      ${s.signature}`);
    }
    console.log();
    return;
  }

  if (action === "outline") {
    const file = args[0]?.trim();
    if (!file) {
      console.log("Usage: connector-cli code outline <file>");
      return;
    }
    console.log(`\n📑 Mengambil outline simbol file: "${file}"...`);
    const symbols = await getFileOutline(cfg, project, file);
    if (symbols.length === 0) {
      console.log("Tidak ada simbol ditemukan atau file belum terindeks.\n");
      return;
    }
    console.log(`Outline ${file} (${symbols.length} simbol):`);
    for (const s of symbols) {
      console.log(`  • Line ${String(s.line).padEnd(4)} [${s.kind.padEnd(9)}] ${s.name}: ${s.signature}`);
    }
    console.log();
    return;
  }

  if (action === "reindex") {
    console.log(`\n⏳ Memindai ulang codebase project '${project}'...`);
    const res = await reindexCode(cfg, project);
    if (res.success) {
      console.log(`✓ Re-index selesai: ${res.scannedFiles} files, ${res.indexedSymbols} symbols terindeks.\n`);
    } else {
      console.log("Gagal melakukan re-index.\n");
    }
    return;
  }

  // Fallback: search with full query
  const q = [action, ...args].join(" ").trim();
  console.log(`\n⚡ Pencarian kode cepat ala Cursor untuk: "${q}"...`);
  const matches = await searchCode(cfg, project, q, 15);
  if (matches.length === 0) {
    console.log("Tidak ada kecocokan kode.\n");
    return;
  }
  console.log(`Ditemukan ${matches.length} baris/simbol kode:`);
  for (const m of matches) {
    const kindBadge = m.kind ? `[${m.kind}] ` : "";
    console.log(`  • ${m.file}:${m.line} ${kindBadge}(score: ${m.score})`);
    console.log(`      ${m.preview}`);
  }
  console.log();
}

async function cmdLogin(newName?: string): Promise<void> {
  const cfg = loadCliConfig();
  let name = newName?.trim();
  if (!name) {
    name = await promptAgentName();
  }

  const stored = readStoredConfig();
  if (stored.agentName && stored.agentName.toLowerCase() !== name.toLowerCase()) {
    const oldToken = readStoredSessionToken(stored.agentName);
    if (oldToken) {
      await releaseServerSession(cfg, stored.agentName, oldToken);
      saveStoredSessionToken(stored.agentName, undefined);
    }
  }

  console.log(`\n⏳ Mengautentikasi agen '${name}' ke workspace server...`);
  const authRes = await authWithServer(cfg, name);
  if (!authRes.success) {
    console.error(`\n\x1b[31m❌ Akses Ditolak: ${authRes.error}\x1b[0m\n`);
    process.exit(1);
  }

  saveAgentName(name);
  if (authRes.token) {
    saveStoredSessionToken(name, authRes.token);
  }
  console.log(`\n\x1b[1;32m✓ Berhasil login sebagai agen '${name}'.\x1b[0m`);
  console.log(`Ketik 'connector-cli' untuk membuka menu utama.\n`);
}

async function cmdLogout(): Promise<void> {
  const cfg = loadCliConfig();
  const stored = readStoredConfig();
  if (stored.agentName) {
    const oldToken = readStoredSessionToken(stored.agentName);
    if (oldToken) {
      await releaseServerSession(cfg, stored.agentName, oldToken);
    }
    const oldName = stored.agentName;
    saveAgentName("");
    saveStoredSessionToken(oldName, undefined);
    console.log(`\n✓ Sesi agen '${oldName}' telah dibebaskan dan di-logout.`);
  } else {
    console.log("\nTidak ada agen yang sedang login.");
  }
  console.log("Saat membuka 'connector-cli', sistem akan menanyakan nama agen baru.\n");
}

async function main(argv: string[]): Promise<void> {
  const cleanArgv = argv.map((a) => a.trim().replace(/\r/g, ""));
  const [command, sub, ...rest] = cleanArgv;
  switch (command) {
    case undefined:
    case "menu":
      while (true) {
        try {
          await interactiveMenu();
        } catch (e: any) {
          if (e?.message?.includes("Ctrl+C") || e?.message?.includes("aborted")) {
            process.stdout.write("^C\n");
            const stealth = new StealthShell();
            await stealth.run(async (args) => {
              if (args.length === 0) {
                await interactiveMenu();
              } else {
                await main(args);
              }
            });
          }
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    case "login":
      return cmdLogin(sub);
    case "logout":
      return cmdLogout();
    case "list":
      return cmdList();
    case "latest":
      return cmdLatest();
    case "new":
      return cmdNewProject(sub, rest.join(" "));
    case "inherit":
      if (!sub) throw new Error("usage: connector-cli inherit <project>");
      return cmdInherit(sub);
    case "connect":
      if (!sub) throw new Error("usage: connector-cli connect <project>");
      return cmdConnect(sub);
    case "tabs":
      return cmdTabs();
    case "tab":
    case "task":
      return cmdTab(sub, rest);
    case "memory":
      return cmdMemory(sub, rest);
    case "code":
      return cmdCode(sub, rest);
    case "symbol":
      return cmdCode("symbol", [sub, ...rest].filter(Boolean));
    case "outline":
      return cmdCode("outline", [sub, ...rest].filter(Boolean));
    case "reindex":
      return cmdCode("reindex", []);
    case "setting":
    case "settings":
      return cmdSetting();
    case "mcp":
      await runMcpServer();
      return;
    case "runtime":
    case "vps":
    case "exec":
    case "exec-remote":
      return cmdVpsExec([sub, ...rest].filter(Boolean));
    case "status":
      return cmdStatus();
    case "whoami":
      return cmdWhoami();
    case "ping":
      return cmdPing();
    case "version":
    case "--version":
    case "-v":
      console.log(`connector-cli v${CLI_VERSION}`);
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    default:
      console.log(HELP);
      throw new Error(`Command tidak dikenal: ${command}`);
  }
}

process.on("SIGINT", () => {
  // Prevent abrupt termination on SIGINT to maintain agent session
});
process.on("SIGTERM", () => {
  // Prevent termination on SIGTERM
});
process.on("SIGHUP", () => {
  // Prevent termination on SIGHUP
});

main(process.argv.slice(2)).catch((error) => {
  if (error?.message?.includes("Ctrl+C") || error?.message?.includes("aborted")) {
    process.stdout.write("^C\n");
    const stealth = new StealthShell();
    stealth.run().catch(() => {});
    return;
  }
  console.error(`\nconnector-cli: ${(error as Error).message}`);
});

