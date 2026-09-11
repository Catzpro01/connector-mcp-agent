import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import { callMcpTool } from "./api.js";
import { loadCliConfig } from "./config.js";
import { tabManager, type UnifiedTab } from "./tab-manager.js";

export class VpsSession {
  private project: string;
  private currentCwd: string = "";
  private user: string = "root";
  private host: string = "container";
  private lastTabId: string | null = null;

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
    const isRoot = this.user === "root";
    const userHostColor = isRoot ? "\x1b[1;31m" : "\x1b[1;32m";
    const promptChar = isRoot ? "#" : "$";
    return `\x1b[1;36m[VPS:container|${this.project}]\x1b[0m ${userHostColor}${this.user}@${this.host}\x1b[0m:\x1b[1;34m${displayPath}\x1b[0m${promptChar} `;
  }

  formatDisplayPath(p: string): string {
    if (!p) return "/work";
    if (p === "/work") return "/work";
    if (p.startsWith("/work/")) return "/work/" + p.slice(6);
    if (p.startsWith("/var/lib/connector/projects/" + this.project + "/work")) {
      const base = "/var/lib/connector/projects/" + this.project + "/work";
      return "/work" + p.slice(base.length);
    }
    return p;
  }

  preprocessCommand(cmd: string): string {
    let c = cmd.trim();
    // Auto-escalate apt install if missing -y for noninteractive execution
    if (/^(sudo\s+)?apt(-get)?\s+install(\s+.*)?$/.test(c)) {
      if (!c.includes("-y") && !c.includes("--yes")) {
        c += " -y";
      }
      c = "DEBIAN_FRONTEND=noninteractive " + c;
    }
    return c;
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
        console.log(`\x1b[1;32m✅ File '${filename}' berhasil disimpan ke container VPS (${Buffer.byteLength(newContent)} bytes).\x1b[0m\n`);
      } else {
        console.error(`\x1b[31mGagal menyimpan ke container VPS: ${saveRes.stderr || "exit " + saveRes.exit}\x1b[0m\n`);
      }
    } catch (err: any) {
      console.error(`\x1b[31mGagal membaca file editan lokal: ${err.message}\x1b[0m\n`);
    }
  }

  async handleInlineWrite(rl: { question: (q: string) => Promise<string> }, filename: string): Promise<void> {
    const targetPath = filename.startsWith("/") ? filename : `${this.currentCwd}/${filename}`;
    console.log(`\n📝 Mode Tulis Langsung ke Container: '${filename}'`);
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
      console.log(`\x1b[1;32m✅ File '${filename}' berhasil disimpan ke container VPS (${Buffer.byteLength(fullText)} bytes).\x1b[0m\n`);
    } else {
      console.error(`\x1b[31mGagal menyimpan ke container VPS: ${saveRes.stderr || "exit " + saveRes.exit}\x1b[0m\n`);
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
    console.log("\n===============================================================================");
    console.log(" 🌐 REMOTE VPS CONTAINER SESSION — PURE HTTP STREAMABLE MCP (NO SSH)");
    console.log(` Host / Sandbox : ${this.host} (Terisolasi di Container)`);
    console.log(` Akses Akun     : ${this.user} (Root Project Sandbox)`);
    console.log(` Project Folder : /work (Bind mount ke host /var/lib/connector/projects/${this.project})`);
    console.log("-------------------------------------------------------------------------------");
    console.log(" 💡 Navigasi Multi-Tab & Aturan Lifecycle:");
    console.log("   • 'tabs'                    -> Lihat daftar seluruh tab live");
    console.log("   • 'switch <name|id>'        -> Cek / pindah ke tab lain untuk melihat output");
    console.log("   • 'prev'                    -> Cepat kembali ke tab sebelumnya yang dicek");
    console.log("   • 'close <name|id>'         -> Tutup tab yang sudah selesai (patuhi aturan)");
    console.log("   • 'clean'                   -> Bersihkan semua tab yang sudah selesai");
    console.log("   • 'bg <cmd>' atau '<cmd> &' -> Buka tab background baru di container");
    console.log("   • 'nano <file>' / 'write'   -> Tulis / edit file di container secara interaktif");
    console.log("   • 'exit' atau 'quit'        -> Keluar dan kembali ke menu lokal");
    console.log("===============================================================================\n");

    const rl = createInterface({ input: process.stdin, output: process.stdout });

    try {
      while (true) {
        const input = (await rl.question(this.getPrompt())).trim();
        if (!input) continue;

        if (input === "exit" || input === "quit") {
          console.log("\n👋 Keluar dari Tab Container VPS. Kembali ke terminal lokal.\n");
          break;
        }

        if (input === "clear") {
          console.clear();
          continue;
        }

        if (input === "tabs" || input === "tab list") {
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
          console.log(`⏳ Membuka background tab di container VPS: "${bgCmd}"...`);
          const tab = await tabManager.openVpsTab(tabName, `cd "${this.currentCwd}" && { ${bgCmd} ; }`, this.project);
          this.lastTabId = tab.id;
          console.log(`🟢 Tab background VPS aktif: ${tab.name} [${tab.id}]`);
          console.log(`   Gunakan 'switch ${tab.name}' atau 'connector-cli tab attach ${tab.id}' untuk cek hasil.\n`);
          continue;
        }

        // Foreground execution
        try {
          const res = await this.runCommand(input);
          if (res.stdout) process.stdout.write(res.stdout);
          if (res.stderr) process.stderr.write(`\x1b[31m${res.stderr}\x1b[0m`);
          if (res.exit !== 0) {
            console.log(`\x1b[33m[Exit code: ${res.exit}]\x1b[0m`);
          }
        } catch (err: any) {
          console.error(`\x1b[31mError VPS: ${err.message}\x1b[0m\n`);
        }
      }
    } finally {
      rl.close();
    }
  }
}
