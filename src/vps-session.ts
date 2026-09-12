import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import {
  callMcpTool,
  getForumChannels,
  getForumComments,
  postForumComment,
  getKnowledgeGraph,
  searchKnowledgeGraph,
  openKnowledgeNodes,
  addKnowledgeObservations,
  createKnowledgeEntities,
  createKnowledgeRelations,
  searchCode,
  findSymbol,
  getFileOutline,
  reindexCode,
} from "./api.js";
import { loadCliConfig } from "./config.js";
import { tabManager, type UnifiedTab } from "./tab-manager.js";

export class VpsSession {
  private project: string;
  private currentCwd: string = "";
  private user: string = "root";
  private host: string = "container";
  private lastTabId: string | null = null;
  private notifiedTabs = new Set<string>();
  private lastExecutedCmd: string = "";

  constructor(project = "smoke-app") {
    this.project = project;
  }

  async init(): Promise<void> {
    const cfg = loadCliConfig();
    try {
      const res = await callMcpTool<{ stdout: string; exit: number }>(cfg, "exec.run", {
        project: this.project,
        command: "pwd && whoami && hostname",
      });
      if (res && res.stdout) {
        const parts = res.stdout.trim().split("\n");
        if (parts[0]) this.currentCwd = parts[0].trim();
        if (parts[1]) this.user = parts[1].trim();
        if (parts[2]) this.host = parts[2].trim();
      }
    } catch {
      this.currentCwd = "/work";
      this.user = "root";
    }
  }

  getCurrentCwd(): string {
    return this.currentCwd;
  }

  setCurrentCwd(cwd: string): void {
    this.currentCwd = cwd;
  }

  getPrompt(): string {
    const displayPath = this.formatDisplayPath(this.currentCwd);
    return `\x1b[1;36m[ RT ]\x1b[0m \x1b[1;32m${this.user}@${this.project}\x1b[0m:\x1b[1;34m${displayPath}\x1b[0m$ `;
  }

  formatDisplayPath(p: string): string {
    if (!p) return "/workspace";
    if (p === "/workspace" || p === "/work") return "/workspace";
    if (p.startsWith("/workspace/")) return p;
    if (p.startsWith("/work/")) return "/workspace" + p.slice(5);
    if (p.startsWith("/var/lib/connector/projects/" + this.project + "/work")) {
      const base = "/var/lib/connector/projects/" + this.project + "/work";
      return "/workspace" + p.slice(base.length);
    }
    return p;
  }

  preprocessCommand(cmd: string): string {
    let c = cmd.trim();
    // Intercept & strip redundant connector-cli prefixes inside runtime shell
    if (c.startsWith("connector-cli runtime ")) {
      c = c.slice("connector-cli runtime ".length).trim();
    } else if (c.startsWith("connector-cli vps ")) {
      c = c.slice("connector-cli vps ".length).trim();
    } else if (c.startsWith("connector-cli exec ")) {
      c = c.slice("connector-cli exec ".length).trim();
    } else if (c.startsWith("connector-cli ")) {
      c = c.slice("connector-cli ".length).trim();
    }

    // Auto-escalate apt install if missing -y for noninteractive execution
    if (/^(sudo\s+)?apt(-get)?\s+install(\s+.*)?$/.test(c)) {
      if (!c.includes("-y") && !c.includes("--yes")) {
        c += " -y";
      }
      c = "DEBIAN_FRONTEND=noninteractive " + c;
    }
    return c;
  }

  async handleMemory(cmd: string): Promise<boolean> {
    const cfg = loadCliConfig();
    const trimmed = cmd.replace(/^(?:connector-cli\s+)?memory\s*/, "").trim();

    if (cmd === "graph" || trimmed === "graph" || trimmed === "") {
      console.log("\n⏳ Mengambil Knowledge Graph dari Persistent Memory...");
      const g = await getKnowledgeGraph(cfg, this.project);
      if (g.entities.length === 0) {
        console.log("Belum ada entitas di Knowledge Graph project ini. Gunakan 'learn <entity> <type> <observasi>'.\n");
      } else {
        console.log(`\n🧠 KNOWLEDGE GRAPH: ${g.entities.length} entitas, ${g.relations.length} relasi`);
        for (const e of g.entities) {
          console.log(`  • \x1b[1;36m[${e.entityType}]\x1b[0m \x1b[1m${e.name}\x1b[0m (${e.observations.length} observasi):`);
          for (const obs of e.observations) {
            console.log(`      - ${obs}`);
          }
        }
        if (g.relations.length > 0) {
          console.log("  🔗 Relasi:");
          for (const r of g.relations) {
            console.log(`      - \x1b[1m${r.from}\x1b[0m --(\x1b[33m${r.relationType}\x1b[0m)--> \x1b[1m${r.to}\x1b[0m`);
          }
        }
        console.log();
      }
      return true;
    }

    const searchMatch = trimmed.match(/^search\s+(.+)$/);
    if (searchMatch) {
      const query = searchMatch[1].trim();
      console.log(`\n🔍 Mencari node Knowledge Graph untuk: "${query}"...`);
      const res = await searchKnowledgeGraph(cfg, this.project, query);
      if (res.entities.length === 0) {
        console.log("Tidak ditemukan entitas yang cocok.\n");
      } else {
        console.log(`Ditemukan ${res.entities.length} entitas terkait:`);
        for (const e of res.entities) {
          console.log(`  • \x1b[1;36m[${e.entityType}]\x1b[0m \x1b[1m${e.name}\x1b[0m:`);
          for (const obs of e.observations) {
            console.log(`      - ${obs}`);
          }
        }
        if (res.relations.length > 0) {
          console.log("  🔗 Relasi 1-hop:");
          for (const r of res.relations) {
            console.log(`      - ${r.from} --(${r.relationType})--> ${r.to}`);
          }
        }
        console.log();
      }
      return true;
    }

    const nodeMatch = trimmed.match(/^node\s+(.+)$/);
    if (nodeMatch) {
      const name = nodeMatch[1].trim();
      console.log(`\n📖 Mengambil sub-graph untuk entitas: "${name}"...`);
      const res = await openKnowledgeNodes(cfg, this.project, [name]);
      if (res.entities.length === 0) {
        console.log(`Entitas '${name}' tidak ditemukan.\n`);
      } else {
        for (const e of res.entities) {
          console.log(`  • \x1b[1;36m[${e.entityType}]\x1b[0m \x1b[1m${e.name}\x1b[0m:`);
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
      }
      return true;
    }

    const learnMatch = trimmed.match(/^learn\s+(\S+)\s+(\S+)\s+(.+)$/);
    if (learnMatch) {
      const [, name, type, obs] = learnMatch;
      console.log(`\n📝 Menyimpan observasi atomik ke graph: [${type}] ${name}...`);
      await createKnowledgeEntities(cfg, this.project, [{ name, entityType: type, observations: [obs] }]);
      console.log(`✓ Observasi permanen tercatat di Knowledge Graph: "${obs}"\n`);
      return true;
    }

    const relateMatch = trimmed.match(/^relate\s+(\S+)\s+(\S+)\s+(\S+)$/);
    if (relateMatch) {
      const [, from, relType, to] = relateMatch;
      console.log(`\n🔗 Menghubungkan relasi: ${from} --(${relType})--> ${to}...`);
      await createKnowledgeRelations(cfg, this.project, [{ from, to, relationType: relType }]);
      console.log(`✓ Relasi berhasil dicatat di Knowledge Graph.\n`);
      return true;
    }

    return false;
  }

  async handleCodeSearch(cmd: string): Promise<boolean> {
    const cfg = loadCliConfig();

    if (cmd === "reindex" || cmd === "connector-cli reindex") {
      console.log("\n⏳ Memindai ulang codebase...");
      const res = await reindexCode(cfg, this.project);
      if (res.success) {
        console.log(`✓ Re-index selesai: ${res.scannedFiles} files, ${res.indexedSymbols} symbols terindeks.\n`);
      } else {
        console.log("Gagal melakukan re-index.\n");
      }
      return true;
    }

    const codeMatch = cmd.match(/^(?:connector-cli\s+)?code(?:\s+search)?\s+(.+)$/);
    if (codeMatch) {
      const q = codeMatch[1].trim().replace(/^["']|["']$/g, "");
      console.log(`\n⚡ Pencarian kode cepat ala Cursor untuk: "${q}"...`);
      const matches = await searchCode(cfg, this.project, q, 15);
      if (matches.length === 0) {
        console.log("Tidak ada kecocokan kode.\n");
      } else {
        console.log(`Ditemukan ${matches.length} baris/simbol kode:`);
        for (const m of matches) {
          const kindBadge = m.kind ? `\x1b[1;33m[${m.kind}]\x1b[0m ` : "";
          console.log(`  • \x1b[1;34m${m.file}:${m.line}\x1b[0m ${kindBadge}(score: ${m.score})`);
          console.log(`      \x1b[2m${m.preview}\x1b[0m`);
        }
        console.log();
      }
      return true;
    }

    const symMatch = cmd.match(/^(?:connector-cli\s+)?symbol\s+(.+)$/);
    if (symMatch) {
      const sym = symMatch[1].trim();
      console.log(`\n🔍 Mencari definisi simbol: "${sym}"...`);
      const symbols = await findSymbol(cfg, this.project, sym);
      if (symbols.length === 0) {
        console.log("Simbol tidak ditemukan di codebase.\n");
      } else {
        console.log(`Ditemukan ${symbols.length} deklarasi simbol:`);
        for (const s of symbols) {
          console.log(`  • \x1b[1;33m[${s.kind}]\x1b[0m \x1b[1m${s.name}\x1b[0m di \x1b[1;34m${s.file}:${s.line}\x1b[0m`);
          console.log(`      ${s.signature}`);
        }
        console.log();
      }
      return true;
    }

    const outlineMatch = cmd.match(/^(?:connector-cli\s+)?outline\s+(.+)$/);
    if (outlineMatch) {
      const file = outlineMatch[1].trim();
      console.log(`\n📑 Mengambil outline simbol file: "${file}"...`);
      const symbols = await getFileOutline(cfg, this.project, file);
      if (symbols.length === 0) {
        console.log("Tidak ada simbol ditemukan atau file belum terindeks.\n");
      } else {
        console.log(`Outline ${file} (${symbols.length} simbol):`);
        for (const s of symbols) {
          console.log(`  • Line ${String(s.line).padEnd(4)} \x1b[1;33m[${s.kind.padEnd(9)}]\x1b[0m \x1b[1m${s.name}\x1b[0m: ${s.signature}`);
        }
        console.log();
      }
      return true;
    }

    return false;
  }

  async handleEditor(editorCmd: string, filename: string): Promise<void> {
    const targetPath = filename.startsWith("/") ? filename : `${this.currentCwd}/${filename}`;
    console.log(`\x1b[36m⏳ Membuka '${filename}' untuk diedit di terminal Anda...\x1b[0m`);

    // 1. Fetch current content from VPS
    let content = "";
    try {
      const readRes = await this.runCommand(`cat "${targetPath}" 2>/dev/null`);
      if (readRes.exit === 0) {
        content = readRes.stdout;
      }
    } catch {}

    // 2. Save to local temp file
    const tempDir = join(tmpdir(), "connector-edit");
    mkdirSync(tempDir, { recursive: true });
    const tempFile = join(tempDir, basename(filename));
    writeFileSync(tempFile, content, "utf8");

    // 3. Resolve local editor
    const isWin = process.platform === "win32";
    let bin = editorCmd;
    let args = [tempFile];

    if (editorCmd === "nano" && isWin) {
      const gitNano = "C:\\Program Files\\Git\\usr\\bin\\nano.exe";
      bin = existsSync(gitNano) ? gitNano : "notepad.exe";
    } else if ((editorCmd === "vim" || editorCmd === "vi") && isWin) {
      const gitVim = "C:\\Program Files\\Git\\usr\\bin\\vim.exe";
      bin = existsSync(gitVim) ? gitVim : "notepad.exe";
    } else if (editorCmd === "code") {
      args = ["--wait", tempFile];
    } else if (editorCmd === "edit") {
      if (process.env.EDITOR) {
        bin = process.env.EDITOR;
      } else if (isWin) {
        const gitNano = "C:\\Program Files\\Git\\usr\\bin\\nano.exe";
        bin = existsSync(gitNano) ? gitNano : "notepad.exe";
      } else {
        bin = "nano";
      }
    }

    // 4. Run local editor with real TTY terminal attached
    try {
      spawnSync(bin, args, { stdio: "inherit" });
    } catch (e: any) {
      console.error(`\x1b[31mGagal membuka editor '${bin}': ${e.message}\x1b[0m\n`);
      return;
    }

    // 5. Read back modified content and save to VPS
    try {
      const newContent = readFileSync(tempFile, "utf8");
      const b64 = Buffer.from(newContent).toString("base64");
      const saveRes = await this.runCommand(
        `mkdir -p "$(dirname "${targetPath}")" && echo "${b64}" | base64 -d > "${targetPath}"`,
      );
      if (saveRes.exit === 0) {
        console.log(`\x1b[1;32m✅ File '${filename}' berhasil disimpan ke workspace (${Buffer.byteLength(newContent)} bytes).\x1b[0m\n`);
      } else {
        console.error(`\x1b[31mGagal menyimpan ke workspace: ${saveRes.stderr || "exit " + saveRes.exit}\x1b[0m\n`);
      }
    } catch (err: any) {
      console.error(`\x1b[31mGagal membaca file editan lokal: ${err.message}\x1b[0m\n`);
    }
  }

  async handleInlineWrite(rl: { question: (q: string) => Promise<string> }, filename: string): Promise<void> {
    const targetPath = filename.startsWith("/") ? filename : `${this.currentCwd}/${filename}`;
    console.log(`\n📝 Mode Tulis Langsung ke Workspace: '${filename}'`);
    console.log("Ketik teks Anda di bawah ini. Masukkan 'EOF' atau 'SAVE' pada baris baru untuk menyimpan:\n");

    const lines: string[] = [];
    while (true) {
      const line = await rl.question("> ");
      if (line.trim() === "EOF" || line.trim() === "SAVE") break;
      lines.push(line);
    }
    const fullText = lines.join("\n") + "\n";
    const b64 = Buffer.from(fullText).toString("base64");
    const saveRes = await this.runCommand(
      `mkdir -p "$(dirname "${targetPath}")" && echo "${b64}" | base64 -d > "${targetPath}"`,
    );
    if (saveRes.exit === 0) {
      console.log(`\x1b[1;32m✅ File '${filename}' berhasil disimpan ke workspace (${Buffer.byteLength(fullText)} bytes).\x1b[0m\n`);
    } else {
      console.error(`\x1b[31mGagal menyimpan ke workspace: ${saveRes.stderr || "exit " + saveRes.exit}\x1b[0m\n`);
    }
  }

  async displayTabResult(tabQuery: string): Promise<void> {
    console.log(`\n🔍 Memeriksa tab "${tabQuery}"...`);
    const res = await tabManager.getLogs(tabQuery);
    if (!res) {
      console.log(`❌ Tab "${tabQuery}" tidak ditemukan.\n`);
      return;
    }
    this.lastTabId = res.tab.id;
    const statusIcon = res.tab.status === "running" ? "🟢 RUNNING" : "⚪ EXITED";
    const exitInfo = res.tab.exit !== null ? ` (Exit code: ${res.tab.exit})` : "";
    console.log("-------------------------------------------------------------------------------");
    console.log(`📑 TAB: ${res.tab.name} [${res.tab.id}] | Target: ${res.tab.target.toUpperCase()}`);
    console.log(`Status: ${statusIcon}${exitInfo} | Command: ${res.tab.command}`);
    console.log("Output Log:");
    console.log("-------------------------------------------------------------------------------");
    console.log(res.logs || "(belum ada output)");
    console.log("-------------------------------------------------------------------------------");

    // ENFORCE TAB LIFECYCLE RULE
    if (res.tab.status === "exited") {
      console.log(`\x1b[33m💡 [LIFECYCLE RULE]: Tab ini sudah selesai.`);
      console.log(`   Jika hasil sudah dicek dan tab tidak lagi digunakan (misal: install/build selesai),`);
      console.log(`   segera tutup tab ini dengan: 'close ${res.tab.name}' atau 'clean'.\x1b[0m\n`);
    } else {
      console.log(`\x1b[32m🟢 Tab masih berjalan di background. Gunakan 'switch ${res.tab.name}' untuk cek berkala.\x1b[0m\n`);
    }
  }

  async runCommand(rawCmd: string): Promise<{ stdout: string; stderr: string; exit: number }> {
    const cfg = loadCliConfig();
    const sentinel = "__CONN_CWD__";
    const processedCmd = this.preprocessCommand(rawCmd);
    const cwdPrefix = this.currentCwd ? `cd "${this.currentCwd}" && ` : "";
    const wrapped = `${cwdPrefix}{ ${processedCmd} ; } ; echo "${sentinel}:$(pwd)"`;

    interface ExecResponse {
      exit: number;
      stdout?: string;
      stderr?: string;
    }
    const res = await callMcpTool<ExecResponse>(cfg, "exec.run", {
      project: this.project,
      command: wrapped,
    });

    let stdout = res?.stdout || "";
    const stderr = res?.stderr || "";
    const exit = typeof res?.exit === "number" ? res.exit : 0;

    const idx = stdout.lastIndexOf(`${sentinel}:`);
    if (idx !== -1) {
      const rest = stdout.slice(idx + sentinel.length + 1);
      const endLine = rest.indexOf("\n");
      const newCwd = endLine !== -1 ? rest.slice(0, endLine).trim() : rest.trim();
      if (newCwd) {
        this.currentCwd = newCwd;
      }
      stdout = stdout.slice(0, idx) + (endLine !== -1 ? rest.slice(endLine + 1) : "");
    }

    return { stdout, stderr, exit };
  }

  async startInteractive(): Promise<void> {
    await this.init();
    console.clear();
    console.log("===============================================================================");
    console.log(" 🟢 WORKSPACE RUNTIME ENVIRONMENT — ISOLATED TASK ENGINE");
    console.log(` Host / Sandbox : ${this.host} (Isolated Environment)`);
    console.log(` Akses Akun     : ${this.user} (Runtime Task Worker)`);
    console.log(` Project Folder : /work`);
    console.log("-------------------------------------------------------------------------------");
    console.log(" 💡 Navigasi Cepat & Fitur:");
    console.log("   • 'help'                    -> Panduan lengkap seluruh perintah di tab runtime");
    console.log("   • 'tabs'                    -> Lihat daftar seluruh tab live");
    console.log("   • 'switch <name|id>'        -> Cek / pindah ke tab lain untuk melihat output");
    console.log("   • 'prev'                    -> Cepat kembali ke tab sebelumnya yang dicek");
    console.log("   • 'close <name|id>'         -> Tutup tab yang sudah selesai");
    console.log("   • 'bg <cmd>' atau '<cmd> &' -> Buka tab background baru di container");
    console.log("   • 'nano <file>' / 'write'   -> Tulis / edit file di container");
    console.log("   • 'exit' atau 'quit'        -> Keluar dan kembali ke menu project");
    console.log("===============================================================================\n");

    const rl = createInterface({ input: process.stdin, output: process.stdout });

    try {
      while (true) {
        // Floating Toast for finished background tabs
        try {
          const allTabs = await tabManager.listTabs();
          for (const t of allTabs) {
            if (t.status === "exited" && !this.notifiedTabs.has(t.id)) {
              this.notifiedTabs.add(t.id);
              const icon = t.exit === 0 ? "\x1b[32m🟢 SUKSES\x1b[0m" : "\x1b[31m🔴 GAGAL\x1b[0m";
              console.log(`\x1b[1;33m🔔 [Tab: ${t.name} SELESAI (${icon}, Exit: ${t.exit})] — Ketik 'switch ${t.name}' untuk cek hasil.\x1b[0m`);
            }
          }
        } catch {}

        let rawInput = "";
        try {
          rawInput = await rl.question(this.getPrompt());
        } catch (err: any) {
          if (err?.message?.includes("Ctrl+C") || err?.message?.includes("aborted")) {
            process.stdout.write("^C\n");
            continue;
          }
          throw err;
        }

        const input = rawInput.replace(/\s+#.*$/, "").trim();
        if (!input) continue;

        // Anti-Exit Trap
        if (input === "exit" || input === "quit") {
          const confirm = (await rl.question("\nKeluar dari Workspace Runtime dan kembali ke menu project? [y/N]: ")).trim().toLowerCase();
          if (confirm === "y" || confirm === "yes") {
            console.log("\n👋 Keluar dari Workspace Runtime. Kembali ke menu project.\n");
            break;
          } else {
            console.log("ℹ️ Pembatalan keluar. Tetap berada di Workspace Runtime.\n");
            continue;
          }
        }

        if (input === "clear") {
          console.clear();
          continue;
        }

        // Lapor progress ke GitHub Issues #progress
        const laporMatch = input.match(/^(?:connector-cli\s+)?lapor\s+(.+)$/);
        if (laporMatch) {
          const pesan = laporMatch[1].trim();
          const uid = `chg-${Date.now().toString(36)}`;
          const cfg = loadCliConfig();
          const formatted = `[${this.user} | ${new Date().toLocaleTimeString()} | ${uid}]: ${pesan}`;
          console.log(`⏳ Memposting laporan [${uid}] ke Channel #progress di GitHub Issues...`);
          const res = await postForumComment(cfg, 2, formatted);
          if (res.success) {
            console.log(`\x1b[32m✓ Laporan [${uid}] berhasil diposting ke GitHub Issues #progress!\x1b[0m\n`);
          } else {
            console.log(`\x1b[33m⚠️ Laporan tercatat lokal [${uid}], task worker tidak terjangkau.\x1b[0m\n`);
          }
          continue;
        }

        // Forum diskusi GitHub Issues
        if (input === "forum" || input === "connector-cli forum") {
          await this.handleForum(rl);
          continue;
        }

        if (input === "tabs" || input === "tab list") {
          const autoHint = `auto: ${this.lastExecutedCmd.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 15) || "workspace"}`;
          const renamed = (await rl.question(`📝 Masukkan label/tujuan tab ini sebelum beralih [default: ${autoHint}]: `)).trim() || autoHint;
          console.log(`\x1b[36m✓ Tab disimpan sebagai "${renamed}". Membuka daftar tab...\x1b[0m`);

          const tabs = await tabManager.listTabs();
          console.log("\n📑 DAFTAR TAB MULTITASKING:");
          if (tabs.length === 0) {
            console.log("  (Belum ada tab aktif atau tersimpan)\n");
            continue;
          }
          for (const t of tabs) {
            const icon = t.status === "running" ? "🟢 RUNNING" : "⚪ EXITED ";
            const exitStr = t.exit !== null ? ` (exit ${t.exit})` : "";
            console.log(`  • [${t.target.toUpperCase()}] ${t.name.padEnd(16)} (${t.id}) -> ${icon}${exitStr} | ${t.command.slice(0, 36)}`);
          }
          console.log("\n💡 Ketik 'switch <name>' untuk cek hasil, 'close <name>' jika sudah selesai.\n");
          continue;
        }

        // Switch to inspect previous/other tab
        const switchMatch = input.match(/^(switch|attach|tab\s+switch|tab\s+attach)\s+(.+)$/);
        if (switchMatch) {
          await this.displayTabResult(switchMatch[2].trim());
          continue;
        }

        // Return to last inspected tab
        if (input === "prev" || input === "tab prev") {
          if (!this.lastTabId) {
            console.log("ℹ️ Belum ada tab sebelumnya yang dicek. Ketik 'tabs' untuk melihat daftar.\n");
          } else {
            await this.displayTabResult(this.lastTabId);
          }
          continue;
        }

        // Close/Kill tab
        const closeMatch = input.match(/^(close|kill|tab\s+close|tab\s+kill)\s+(.+)$/);
        if (closeMatch) {
          const target = closeMatch[2].trim();
          console.log(`⏳ Menutup tab "${target}"...`);
          const res = await tabManager.killTab(target);
          console.log(res.message + "\n");
          continue;
        }

        // Clean exited tabs
        if (input === "clean" || input === "tab clean") {
          const count = tabManager.cleanTabs();
          console.log(`🧹 ${count} tab yang telah selesai berhasil dibersihkan.\n`);
          continue;
        }

        // Inline write requested (e.g. write test.txt or cat > test.txt)
        const inlineMatch = input.match(/^(write|cat\s*>)\s+(.+)$/);
        if (inlineMatch) {
          await this.handleInlineWrite(rl, inlineMatch[2].trim());
          continue;
        }

        // Interactive editor requested (nano, vim, vi, edit, code, notepad)
        const editorMatch = input.match(/^(nano|vim|vi|edit|code|notepad)\s+(.+)$/);
        if (editorMatch) {
          await this.handleEditor(editorMatch[1], editorMatch[2].trim());
          continue;
        }

        // Background task requested
        if (input.startsWith("bg ") || input.endsWith("&")) {
          const bgCmd = input.startsWith("bg ") ? input.slice(3).trim() : input.slice(0, -1).trim();
          const tabName = `bg-${Date.now().toString(36)}`;
          console.log(`⏳ Memulai background task: "${bgCmd}"...`);
          const tab = await tabManager.openVpsTab(tabName, `cd "${this.currentCwd}" && { ${bgCmd} ; }`, this.project);
          this.lastTabId = tab.id;
          console.log(`🟢 Task background aktif: ${tab.name} [${tab.id}]`);
          console.log(`   Gunakan 'switch ${tab.name}' atau 'connector-cli tab attach ${tab.id}' untuk cek hasil.\n`);
          continue;
        }

        // Help & Info
        if (input === "help" || input === "connector-cli help") {
          console.log("\n======================== BANTUAN PERINTAH TAB RUNTIME ========================");
          console.log(" Anda berada di dalam Workspace Runtime Environment.");
          console.log(" Perintah Shell Linux dijalankan langsung di isolated environment:");
          console.log("   whoami, pwd, ls -la, cat <file>, git status, npm test, python3 app.py");
          console.log("\n Akses MCP Knowledge Graph (Persistent Memory):");
          console.log("   graph                                -> Tampilkan seluruh Knowledge Graph");
          console.log("   search <query>                       -> Cari entitas & relasi di graph");
          console.log("   node <nama>                          -> Lihat detail sub-graph entitas");
          console.log("   learn <entitas> <tipe> <catatan>     -> Rekam observasi permanen baru");
          console.log("   relate <dari> <tipe_relasi> <ke>     -> Hubungkan relasi antar node");
          console.log("\n Akses Cursor-Style Code Indexer:");
          console.log("   code <query>                         -> Pencarian kode instan secepat Cursor");
          console.log("   symbol <nama>                        -> Temukan definisi fungsi / class / struct");
          console.log("   outline <file>                       -> Lihat daftar simbol file");
          console.log("   reindex                              -> Pindai ulang AST codebase");
          console.log("\n Navigasi & File Editor:");
          console.log("   nano <file> | vim <file>             -> Edit file di terminal lokal");
          console.log("   write <file>                         -> Tulis file langsung ke workspace");
          console.log("   tabs | switch <name>                 -> Multitasking background tab");
          console.log("   exit                                 -> Kembali ke menu project");
          console.log("=============================================================================\n");
          continue;
        }

        if (input === "connector-cli" || input === "connector-cli runtime") {
          console.log("ℹ️ Anda sudah berada di dalam Workspace Runtime Environment.");
          console.log("Ketik 'help' untuk daftar perintah, atau ketik langsung perintah Linux (misal: 'whoami', 'ls', 'pwd').\n");
          continue;
        }

        // Intercept MCP Memory Commands
        if (
          input === "graph" ||
          input.startsWith("graph ") ||
          input.startsWith("connector-cli memory") ||
          input.startsWith("memory ") ||
          input.startsWith("learn ") ||
          input.startsWith("relate ") ||
          input.startsWith("node ") ||
          (input.startsWith("search ") && !input.startsWith("search-"))
        ) {
          const handled = await this.handleMemory(input);
          if (handled) continue;
        }

        // Intercept Cursor-Style Code Index Commands
        if (
          input === "reindex" ||
          input === "connector-cli reindex" ||
          input.startsWith("code ") ||
          input.startsWith("connector-cli code") ||
          input.startsWith("symbol ") ||
          input.startsWith("connector-cli symbol") ||
          input.startsWith("outline ") ||
          input.startsWith("connector-cli outline")
        ) {
          const handled = await this.handleCodeSearch(input);
          if (handled) continue;
        }

        // Intercept general 'connector-cli vps <cmd>' or 'connector-cli <cmd>'
        let targetCmd = input;
        if (targetCmd.startsWith("connector-cli vps ")) {
          targetCmd = targetCmd.slice("connector-cli vps ".length).trim();
        } else if (targetCmd.startsWith("connector-cli exec ")) {
          targetCmd = targetCmd.slice("connector-cli exec ".length).trim();
        } else if (targetCmd.startsWith("connector-cli ")) {
          targetCmd = targetCmd.slice("connector-cli ".length).trim();
        }

        // Foreground execution
        try {
          this.lastExecutedCmd = targetCmd;
          const res = await this.runCommand(targetCmd);
          if (res.stdout) process.stdout.write(res.stdout);
          if (res.stderr) process.stderr.write(`\x1b[31m${res.stderr}\x1b[0m`);
          if (res.exit !== 0) {
            console.log(`\x1b[33m[Exit code: ${res.exit}]\x1b[0m`);
          }
        } catch (err: any) {
          console.error(`\x1b[31mError runtime: ${err.message}\x1b[0m\n`);
        }
      }
    } finally {
      rl.close();
    }
  }

  async handleForum(rl: any): Promise<void> {
    const cfg = loadCliConfig();
    console.log("\n💬 ==================== FORUM DISKUSI AGENT ====================");
    console.log("Mengambil channel aktif dari GitHub Issues (connector-agent-forum)...");
    const channels = await getForumChannels(cfg);
    if (channels.length === 0) {
      console.log("Belum ada channel terhubung.\n");
      return;
    }
    channels.sort((a, b) => a.number - b.number);
    console.log("----------------------------------------------------------------");
    channels.forEach((c, idx) => {
      console.log(`  ${idx + 1}. #${c.number} ${c.title}`);
    });
    console.log("  B. Kembali");
    console.log("----------------------------------------------------------------");
    const chChoice = (await rl.question("Pilih channel (nomor / B): ")).trim().toLowerCase();
    if (chChoice === "b" || chChoice === "back") return;
    const idx = parseInt(chChoice, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= channels.length) {
      console.log("Pilihan tidak valid.\n");
      return;
    }
    const selected = channels[idx];
    console.log(`\n📂 [${selected.title}]`);
    console.log("Mengambil komentar terbaru...");
    const comments = await getForumComments(cfg, selected.number);
    if (comments.length === 0) {
      console.log("  (Belum ada komentar di channel ini)");
    } else {
      for (const c of comments.slice(-10)) {
        console.log(`\n\x1b[1;36m[${c.author.login} | ${new Date(c.createdAt).toLocaleTimeString()}]:\x1b[0m`);
        console.log(`  ${c.body}`);
      }
    }
    console.log("\n----------------------------------------------------------------");
    if (selected.number === 1) {
      console.log("ℹ️ Channel ini adalah PENGUMUMAN USER (Read Only).");
      await rl.question("Tekan Enter untuk kembali...");
      return;
    }
    const msg = (await rl.question("\nTulis pesan untuk dikirim (Enter untuk batal): ")).trim();
    if (msg) {
      const uid = `chg-${Date.now().toString(36)}`;
      const formatted = `[${this.user} | ${new Date().toLocaleTimeString()} | ${uid}]: ${msg}`;
      console.log("Mengirim pesan ke GitHub Issues...");
      const res = await postForumComment(cfg, selected.number, formatted);
      if (res.success) {
        console.log(`\x1b[32m✓ Pesan berhasil terkirim ke Channel #${selected.number}!\x1b[0m\n`);
      } else {
        console.log("\x1b[31m❌ Gagal mengirim pesan ke server.\x1b[0m\n");
      }
    }
  }
}
