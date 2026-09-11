import { createInterface } from "node:readline/promises";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOCAL_DISK_DIR } from "./agent-name.js";

export class SessionDiskSession {
  private project: string;
  private agentName: string;
  private sessionDir: string;
  private currentDir: string;

  constructor(project: string, agentName: string) {
    this.project = project;
    this.agentName = agentName;
    this.sessionDir = join(LOCAL_DISK_DIR, "sessions", project);
    mkdirSync(join(this.sessionDir, "memory"), { recursive: true });
    mkdirSync(join(this.sessionDir, "skills"), { recursive: true });
    this.currentDir = this.sessionDir;

    // Ensure default initial memory files
    const inboxFile = join(this.sessionDir, "memory", "INBOX.md");
    if (!existsSync(inboxFile)) {
      writeFileSync(inboxFile, "# Offline Inbox & Mentions\n\n(Tidak ada pesan tertunda)\n", "utf8");
    }
    const evalFile = join(this.sessionDir, "memory", "EVALUATION.md");
    if (!existsSync(evalFile)) {
      writeFileSync(evalFile, "# Catatan Evaluasi & Refleksi Mandiri\n\n(Catatan generasi akan disimpan di sini)\n", "utf8");
    }
  }

  getPrompt(): string {
    const rel = this.currentDir === this.sessionDir ? "/session" : "/session" + this.currentDir.slice(this.sessionDir.length).replace(/\\/g, "/");
    return `\x1b[1;35m[ SESSION ]\x1b[0m \x1b[1;32m${this.agentName}@${this.project}\x1b[0m:\x1b[1;34m${rel}\x1b[0m$ `;
  }

  async startInteractive(): Promise<void> {
    console.log("\n===============================================================================");
    console.log(` 💾 TAB DISK SESSION — ${this.project} (Local Session Disk)`);
    console.log(` Direktori Lokal: ${this.sessionDir}`);
    console.log(" Fitur: 'ls', 'cat <file>', 'write <file>', 'clear', 'inbox', 'exit'");
    console.log("===============================================================================\n");

    const rl = createInterface({ input: process.stdin, output: process.stdout });

    try {
      while (true) {
        const input = (await rl.question(this.getPrompt())).trim();
        if (!input) continue;

        if (input === "exit" || input === "quit") {
          console.log("\n👋 Keluar dari Tab Disk Session. Kembali ke menu project.\n");
          break;
        }

        if (input === "clear") {
          console.clear();
          continue;
        }

        if (input === "pwd") {
          console.log(this.currentDir + "\n");
          continue;
        }

        if (input === "inbox") {
          const inboxPath = join(this.sessionDir, "memory", "INBOX.md");
          if (existsSync(inboxPath)) {
            console.log("\n📬 ISI OFFLINE INBOX:\n" + readFileSync(inboxPath, "utf8") + "\n");
          }
          continue;
        }

        if (input === "ls" || input === "dir") {
          try {
            const entries = readdirSync(this.currentDir);
            for (const e of entries) {
              const full = join(this.currentDir, e);
              const isDir = statSync(full).isDirectory();
              const color = isDir ? "\x1b[1;34m" : "\x1b[0m";
              console.log(`  ${color}${e}${isDir ? "/" : ""}\x1b[0m`);
            }
            console.log();
          } catch (err) {
            console.error(`Error ls: ${(err as Error).message}\n`);
          }
          continue;
        }

        const cdMatch = input.match(/^cd\s+(.+)$/);
        if (cdMatch) {
          const target = cdMatch[1].trim();
          if (target === ".." || target === "../") {
            if (this.currentDir !== this.sessionDir) {
              this.currentDir = this.sessionDir;
            }
          } else {
            const next = join(this.currentDir, target);
            if (existsSync(next) && statSync(next).isDirectory() && next.startsWith(this.sessionDir)) {
              this.currentDir = next;
            } else {
              console.log(`Direktori tidak ditemukan: ${target}\n`);
            }
          }
          continue;
        }

        const catMatch = input.match(/^cat\s+(.+)$/);
        if (catMatch) {
          const file = join(this.currentDir, catMatch[1].trim());
          if (existsSync(file) && !statSync(file).isDirectory()) {
            console.log("\n" + readFileSync(file, "utf8") + "\n");
          } else {
            console.log(`File tidak ditemukan: ${catMatch[1]}\n`);
          }
          continue;
        }

        const writeMatch = input.match(/^write\s+(.+)$/);
        if (writeMatch) {
          const file = join(this.currentDir, writeMatch[1].trim());
          console.log(`Ketik konten untuk file '${writeMatch[1]}'. Ketik baris 'EOF' untuk selesai:`);
          const lines: string[] = [];
          while (true) {
            const line = await rl.question("");
            if (line.trim() === "EOF") break;
            lines.push(line);
          }
          writeFileSync(file, lines.join("\n") + "\n", "utf8");
          console.log(`✓ File '${writeMatch[1]}' tersimpan.\n`);
          continue;
        }

        console.log(`Perintah lokal '${input}' tidak dikenal. Tersedia: ls, cd, cat, write, inbox, clear, exit\n`);
      }
    } finally {
      rl.close();
    }
  }
}
