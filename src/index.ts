#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { loadCliConfig, DEFAULT_CONNECTOR_URL } from "./config.js";
import { getInheritance, getManifest, listProjects, callMcpTool, type ProjectSummary } from "./api.js";
import { downloadSkills } from "./skills.js";
import { createSessionDisk } from "./sessiondisk.js";
import { registerMcpConfig } from "./mcp-config.js";
import { promptAgentName, saveAgentName, readStoredAgentName, readStoredConfig, saveStoredConfig } from "./agent-name.js";
import { localTasks } from "./local-tasks.js";
import { tabManager } from "./tab-manager.js";
import { runMcpServer } from "./mcp-server.js";
import { VpsSession } from "./vps-session.js";

const HELP = `connector-cli — remote workspace & MCP agent connector.

Usage:
  connector-cli                            Buka menu interaktif
  connector-cli list                       Lihat daftar project di VPS
  connector-cli latest                     Lihat project terbaru & ringkasan memori
  connector-cli new <name> [desc]          Buat project baru di VPS
  connector-cli connect <project>          Konek project, unduh skill, register .mcp.json
  connector-cli inherit <project>          Lihat pewarisan context generasi sebelumnya
  connector-cli vps [command]              Masuk ke tab shell interaktif VPS, atau jalankan perintah langsung (pure HTTP)
  connector-cli tab vps                    Buka sesi tab terminal interaktif di VPS remote
  connector-cli tabs                       Lihat dashboard semua tab live (Laptop & VPS)
  connector-cli tab new [--vps] [name] <cmd...> Buka tab background baru
  connector-cli tab list                   Daftar tab live
  connector-cli tab attach <name|id>       Lihat output real-time tab
  connector-cli tab kill <name|id>         Hentikan tab yang sedang berjalan
  connector-cli tab clean                  Bersihkan tab-tab yang sudah selesai/exited
  connector-cli setting                    Konfigurasi link server & API key
  connector-cli status                     Cek status koneksi VPS
  connector-cli help                       Tampilkan bantuan ini
`;

function printProjectTable(projects: ProjectSummary[]): void {
  if (projects.length === 0) {
    console.log("Belum ada project di VPS. Gunakan opsi 'new project'.");
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
  console.log("\n📦 DAFTAR PROJECT DI VPS:");
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
  console.log(`\n⏳ Membuat project '${pName}' di VPS...`);
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

  // Register enter session di VPS agar generation naik dan dicatat di Ledger
  try {
    await callMcpTool(cfg, "session.enter", { project: slug });
    console.log(`🚀 Sesi aktif tercatat di Ledger VPS untuk ${slug}.`);
  } catch (e) {
    // Biarkan tetap lanjut
  }

  console.log(`\n💾 Session Disk: ${disk.path} (terisolasi, dibersihkan saat sesi selesai)`);
  console.log(`🔗 Terhubung ke VPS! Semua tool remote kini aktif.`);
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
  console.log("  2. VPS Remote");
  const loc = (await rl.question("Pilihan (1/2, default: 1): ")).trim() || "1";
  if (loc === "2") {
    console.log("\nPilih Mode Tab VPS:");
    console.log("  1. Masuk ke Sesi Tab Interaktif VPS (Foreground Remote Shell) [Default]");
    console.log("  2. Jalankan Perintah di Background Tab (Latar Belakang)");
    const mode = (await rl.question("Pilihan (1/2, default: 1): ")).trim() || "1";
    if (mode === "1") {
      rl.close();
      const session = new VpsSession("smoke-app");
      await session.startInteractive();
      return;
    }
    const cmd = (await rl.question("Perintah background VPS: ")).trim();
    rl.close();
    if (!cmd) {
      console.log("Perintah tidak boleh kosong.");
      return;
    }
    console.log(`\n⏳ Membuka Tab VPS "${name}"...`);
    const tab = await tabManager.openVpsTab(name, cmd);
    console.log(`✅ Tab VPS "${tab.name}" [${tab.id}] BERJALAN di latar belakang VPS.`);
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
  console.log("\n⚙️  PENGATURAN SERVER & KREDENSIAL");
  console.log(`Link Server saat ini : ${stored.url || process.env.CONNECTOR_URL || "(belum disetel)"}`);
  console.log(`API Key saat ini     : ${stored.apiKey || process.env.CONNECTOR_API_KEY ? "********" : "(belum disetel)"}`);
  console.log(`Nama Agent saat ini  : ${stored.agentName || process.env.CONNECTOR_AGENT || "(belum disetel)"}`);
  console.log();

  const newUrl = await rl.question("Masukkan Link Server VPS baru (Enter untuk lewati): ");
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
  if (!res.ok) throw new Error(`Connector di ${cfg.url} tidak merespons (HTTP ${res.status}).`);
  const body = (await res.json()) as { ok: boolean; mode: string };
  console.log(`\n✅ Connector di ${cfg.url} sehat (Mode eksekusi: ${body.mode}).`);
  const { projects } = await listProjects(cfg);
  console.log(`Total ${projects.length} project:`);
  printProjectTable(projects);
}

async function cmdTab(sub: string, args: string[]): Promise<void> {
  switch (sub) {
    case "vps":
    case "remote":
    case "shell": {
      const session = new VpsSession(args[0] || "smoke-app");
      return session.startInteractive();
    }
    case "new":
    case "run":
    case "start": {
      let isVps = false;
      const cleanArgs = [...args];
      if (cleanArgs[0] === "--vps" || cleanArgs[0] === "-v") {
        isVps = true;
        cleanArgs.shift();
      }
      if (cleanArgs.length === 0) {
        throw new Error("usage: connector-cli tab new [--vps] [name] <command...>");
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

      if (isVps) {
        const tab = await tabManager.openVpsTab(tabName, command);
        console.log(`✅ Tab VPS "${tab.name}" [${tab.id}] berjalan di background VPS.`);
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

/** Tampilan Menu Interaktif Bersih */
async function interactiveMenu(): Promise<void> {
  let stored = readStoredConfig();
  if (!stored.url) {
    saveStoredConfig({ url: DEFAULT_CONNECTOR_URL });
    stored = readStoredConfig();
  }
  let agentName = process.env.CONNECTOR_AGENT || stored.agentName;
  if (!agentName) {
    agentName = process.env.USERNAME || process.env.USER || "agent-primary";
    saveAgentName(agentName);
  }

  while (true) {
    const cfg = loadCliConfig();
    let serverStatus = "menghubungkan...";
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${cfg.url}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        serverStatus = `🟢 ${cfg.url} (VPS Terhubung - Bebas API Key)`;
      } else {
        serverStatus = `🟡 ${cfg.url} (HTTP ${res.status})`;
      }
    } catch {
      serverStatus = `🔴 ${cfg.url} (Offline / Timeout)`;
    }

    console.log("\n=======================================================");
    console.log(` login : ${agentName}`);
    console.log(` server: ${serverStatus}`);
    console.log("-------------------------------------------------------");
    console.log("  1. project latest");
    console.log("  2. new project");
    console.log("  3. project list");
    console.log("  4. 🌐 masuk ke tab vps (interactive remote shell)");
    console.log("  5. new tab (run task background)");
    console.log("  6. tab live (supervisi status multitask)");
    console.log("  7. setting");
    console.log("  8. exit");
    console.log("=======================================================");

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const choice = (await rl.question("\nPilih menu (1-8): ")).trim();
    rl.close();

    try {
      if (choice === "1") {
        await cmdLatest();
      } else if (choice === "2") {
        await cmdNewProject();
      } else if (choice === "3") {
        await cmdList();
      } else if (choice === "4") {
        const session = new VpsSession("smoke-app");
        await session.startInteractive();
      } else if (choice === "5") {
        await cmdNewTab();
      } else if (choice === "6") {
        await cmdTabs();
      } else if (choice === "7") {
        await cmdSetting();
      } else if (choice === "8" || choice.toLowerCase() === "exit" || choice.toLowerCase() === "q") {
        console.log("Sampai jumpa!");
        break;
      } else {
        console.log("Pilihan tidak valid. Masukkan angka 1 sampai 8.");
      }
    } catch (err) {
      console.error(`\n❌ Error: ${(err as Error).message}`);
    }
  }
}

async function cmdVpsExec(args: string[]): Promise<void> {
  const remoteCmd = args.join(" ").trim();
  if (!remoteCmd) {
    const session = new VpsSession("smoke-app");
    return session.startInteractive();
  }
  const cfg = loadCliConfig();
  console.log(`\x1b[1;36m[VPS: master | smoke-app]\x1b[0m \x1b[1;32mfern@master\x1b[0m: \x1b[1m${remoteCmd}\x1b[0m\n`);

  interface ExecResponse {
    exit: number;
    stdout?: string;
    stderr?: string;
  }

  const res = await callMcpTool<ExecResponse>(cfg, "exec.run", {
    project: "smoke-app",
    command: remoteCmd,
  });

  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(`\x1b[31m${res.stderr}\x1b[0m`);
  if (res.exit !== 0) {
    process.exitCode = res.exit;
  }
}

async function main(argv: string[]): Promise<void> {
  const cleanArgv = argv.map((a) => a.trim().replace(/\r/g, ""));
  const [command, sub, ...rest] = cleanArgv;
  switch (command) {
    case undefined:
      return interactiveMenu();
    case "menu":
      return interactiveMenu();
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
    case "setting":
    case "settings":
      return cmdSetting();
    case "mcp":
      await runMcpServer();
      return;
    case "vps":
    case "exec":
    case "exec-remote":
      return cmdVpsExec([sub, ...rest].filter(Boolean));
    case "status":
      return cmdStatus();
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

main(process.argv.slice(2)).catch((error) => {
  console.error(`\nconnector-cli: ${(error as Error).message}`);
  process.exit(1);
});

