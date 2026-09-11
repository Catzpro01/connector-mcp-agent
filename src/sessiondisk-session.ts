import { createInterface } from "node:readline/promises";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOCAL_DISK_DIR } from "./agent-name.js";
import { loadCliConfig } from "./config.js";
import {
  callMcpTool,
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
import { importProjectMemorySilent } from "./memory-sync.js";

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
    const cfg = loadCliConfig();
    console.clear();
    console.log("===============================================================================");
    console.log(` 💾 TAB DISK SESSION — ${this.project} (Local Session Disk & MCP Memory)`);
    console.log(` Direktori Lokal: ${this.sessionDir}`);
    console.log(" • File Lokal   : ls, cd, cat, write, inbox, clear, exit");
    console.log(" • Memory Graph : graph, search <query>, node <name>, learn, relate, import");
    console.log(" • Cursor Index : code <query>, symbol <name>, outline <file>, reindex");
    console.log(" • Bantuan      : ketik 'help' kapan saja untuk penjelasan fitur");
    console.log("===============================================================================\n");

    const rl = createInterface({ input: process.stdin, output: process.stdout });

    try {
      while (true) {
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

        // 1. Strip inline comments and trim
        let input = rawInput.replace(/\s+#.*$/, "").trim();
        if (!input) continue;

        // 2. Strip connector-cli prefix if present
        if (input.startsWith("connector-cli ")) {
          input = input.slice("connector-cli ".length).trim();
        }

        // 3. Forward VPS execution directly if requested inside session disk
        if (input.startsWith("vps ") || input.startsWith("exec ")) {
          const vpsCmd = input.replace(/^(?:vps|exec)\s+/, "").trim();
          console.log(`\n⏳ Menjalankan di container VPS: "${vpsCmd}"...`);
          try {
            const res = await callMcpTool<{ stdout: string; stderr: string; exit: number }>(cfg, "exec.run", {
              project: this.project,
              command: vpsCmd,
            });
            if (res.stdout) process.stdout.write(res.stdout);
            if (res.stderr) process.stderr.write(`\x1b[31m${res.stderr}\x1b[0m`);
            if (res.exit !== 0) console.log(`\x1b[33m[Exit code: ${res.exit}]\x1b[0m`);
          } catch (e: any) {
            console.error(`Gagal eksekusi VPS: ${e.message}\n`);
          }
          console.log();
          continue;
        }

        // 4. Normalize memory prefixes
        if (input.startsWith("memory ")) {
          input = input.slice("memory ".length).trim();
        }
        if (input === "memory") {
          input = "graph";
        }

        // 5. Normalize code search
        if (input.startsWith("code search ")) {
          input = "code " + input.slice("code search ".length).trim();
        }

        if (input === "help" || input === "?") {
          console.log("\n======================== BANTUAN TAB DISK SESSION ========================");
          console.log(" Anda berada di Tab Disk Session (Local Session Disk & MCP Memory).");
          console.log(" Perintah File Lokal:");
          console.log("   ls, pwd, cd <dir>, cat <file>, write <file>");
          console.log("   inbox                                -> Lihat pesan/mention offline tim");
          console.log("\n Akses Knowledge Graph MCP:");
          console.log("   graph                                -> Tampilkan seluruh Knowledge Graph");
          console.log("   search <query>                       -> Cari entitas & relasi di graph");
          console.log("   node <nama>                          -> Buka detail sub-graph entitas");
          console.log("   learn <entitas> <tipe> <catatan>     -> Rekam fakta permanen baru");
          console.log("   relate <dari> <tipe_relasi> <ke>     -> Hubungkan relasi antar entitas");
          console.log("   import / sync                        -> Segarkan memori & knowledge graph dari cloud");
          console.log("\n Cursor-Style Code Indexer:");
          console.log("   code <query>                         -> Cari baris & simbol kode secepat Cursor");
          console.log("   symbol <nama>                        -> Temukan definisi fungsi / class / struct");
          console.log("   outline <file>                       -> Lihat susunan simbol suatu file");
          console.log("   reindex                              -> Re-index codebase project di VPS");
          console.log("\n   exit                                 -> Kembali ke menu project");
          console.log("==========================================================================\n");
          continue;
        }

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

        // ---- Memory Graph Commands ----
        if (input === "graph") {
          console.log("\n⏳ Mengambil Knowledge Graph dari VPS...");
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
          continue;
        }

        const searchMatch = input.match(/^search\s+(.+)$/);
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
          continue;
        }

        const nodeMatch = input.match(/^node\s+(.+)$/);
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
          continue;
        }

        const learnMatch = input.match(/^learn\s+(\S+)\s+(\S+)\s+(.+)$/);
        if (learnMatch) {
          const [, name, type, obs] = learnMatch;
          console.log(`\n📝 Menyimpan observasi atomik ke graph: [${type}] ${name}...`);
          await createKnowledgeEntities(cfg, this.project, [{ name, entityType: type, observations: [obs] }]);
          console.log(`✓ Observasi permanen tercatat di Knowledge Graph: "${obs}"\n`);
          importProjectMemorySilent(cfg, this.project, this.agentName).catch(() => {});
          continue;
        }

        const relateMatch = input.match(/^relate\s+(\S+)\s+(\S+)\s+(\S+)$/);
        if (relateMatch) {
          const [, from, relType, to] = relateMatch;
          console.log(`\n🔗 Menghubungkan relasi: ${from} --(${relType})--> ${to}...`);
          await createKnowledgeRelations(cfg, this.project, [{ from, to, relationType: relType }]);
          console.log(`✓ Relasi berhasil dicatat di Knowledge Graph.\n`);
          importProjectMemorySilent(cfg, this.project, this.agentName).catch(() => {});
          continue;
        }

        if (input === "import" || input === "sync" || input === "import-memory") {
          console.log(`\n⏳ Memperbarui snapshot memori proyek '${this.project}' ke disk lokal...`);
          const res = await importProjectMemorySilent(cfg, this.project, this.agentName);
          if (res.success) {
            console.log(`✓ Memori teranyar tersimpan: ${res.entityCount} entitas, ${res.relationCount} relasi di /session/memory/\n`);
          } else {
            console.log(`✓ Memori lokal telah sinkron.\n`);
          }
          continue;
        }

        // ---- Cursor-Style Code Index Commands ----
        const codeMatch = input.match(/^code\s+(.+)$/);
        if (codeMatch) {
          const q = codeMatch[1].trim();
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
          continue;
        }

        const symbolMatch = input.match(/^symbol\s+(.+)$/);
        if (symbolMatch) {
          const sym = symbolMatch[1].trim();
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
          continue;
        }

        const outlineMatch = input.match(/^outline\s+(.+)$/);
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
          continue;
        }

        if (input === "reindex") {
          console.log("\n⏳ Memindai ulang codebase di VPS...");
          const res = await reindexCode(cfg, this.project);
          if (res.success) {
            console.log(`✓ Re-index selesai: ${res.scannedFiles} files, ${res.indexedSymbols} symbols terindeks.\n`);
          } else {
            console.log("Gagal melakukan re-index.\n");
          }
          continue;
        }

        // ---- Standard File Operations ----
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

        console.log(`Perintah '${input}' tidak dikenal.`);
        console.log("Tersedia: ls, cd, cat, write, inbox, graph, search, node, learn, relate, code, symbol, outline, reindex, clear, exit\n");
      }
    } finally {
      rl.close();
    }
  }
}
