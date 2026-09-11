import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { tabManager } from "./tab-manager.js";
import { callMcpTool } from "./api.js";
import { loadCliConfig } from "./config.js";

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: "multitasking-tabs",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "tab_new",
          description:
            "Buka tab command prompt background baru (di Laptop atau VPS) untuk menjalankan compile, instalasi, pengujian, atau perintah panjang tanpa memblokir agen. ATURAN: Tab instalasi/kompilasi yang telah selesai dicek WAJIB segera ditutup dengan tab_kill/tab_clean agar resource bersih; tab daemon/service yang masih digunakan dapat dibiarkan aktif.",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Nama alias tab (misal: 'cargo-build', 'npm-install', 'test-suite')",
              },
              command: {
                type: "string",
                description: "Perintah shell lengkap yang akan dieksekusi di background",
              },
              target: {
                type: "string",
                enum: ["laptop", "vps"],
                description: "Target eksekusi: 'laptop' (default) atau 'vps' (untuk beban komputasi berat)",
              },
              cwd: {
                type: "string",
                description: "Working directory lokal (hanya berlaku untuk target laptop)",
              },
            },
            required: ["command"],
          },
        },
        {
          name: "tab_list",
          description:
            "Melihat live dashboard semua tab multitasking (Laptop & VPS) yang sedang berjalan (running) maupun sudah selesai (exited) beserta exit code-nya.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "tab_attach",
          description:
            "Mengintip log output realtime dari tab tertentu (stdout & stderr) berdasarkan nama tab atau ID tab. ATURAN: Jika tab adalah tugas sekali pakai (seperti apt install, build) dan sudah selesai, agen WAJIB segera menutupnya dengan tab_kill atau tab_clean setelah memeriksa hasilnya.",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Nama alias tab atau ID tab (misal: 'cargo-build' atau 'lt-mtx4b6zm-0')",
              },
            },
            required: ["name"],
          },
        },
        {
          name: "tab_kill",
          description: "Menghentikan tab yang sedang berjalan secara paksa (SIGTERM/SIGKILL).",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Nama alias tab atau ID tab yang ingin dihentikan",
              },
            },
            required: ["name"],
          },
        },
        {
          name: "tab_clean",
          description: "Membersihkan tab-tab yang sudah berstatus 'exited' agar riwayat tetap rapi.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "vps_exec",
          description: "Jalankan perintah langsung di Linux VPS via pure HTTP streamable MCP (tanpa SSH).",
          inputSchema: {
            type: "object",
            properties: {
              command: {
                type: "string",
                description: "Perintah Linux yang akan dijalankan langsung di VPS",
              },
            },
            required: ["command"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args || {}) as Record<string, any>;

    switch (name) {
      case "tab_new": {
        const cmd = String(a.command || "").trim();
        const tabName = a.name ? String(a.name).trim() : `tab-${Date.now().toString(36)}`;
        const target = a.target === "vps" ? "vps" : "laptop";
        const cwd = a.cwd ? String(a.cwd) : process.cwd();

        if (target === "vps") {
          const tab = await tabManager.openVpsTab(tabName, cmd);
          return {
            content: [
              {
                type: "text",
                text: `✅ Tab VPS "${tab.name}" [${tab.id}] berhasil dibuka di background VPS.\nCommand: ${cmd}\nStatus: ${tab.status}`,
              },
            ],
          };
        } else {
          const tab = tabManager.openLocalTab(tabName, cmd, cwd);
          return {
            content: [
              {
                type: "text",
                text: `✅ Tab Laptop "${tab.name}" [${tab.id}] berhasil dibuka di background Laptop.\nCommand: ${cmd}\nStatus: ${tab.status}`,
              },
            ],
          };
        }
      }

      case "tab_list": {
        const tabs = await tabManager.listTabs();
        if (tabs.length === 0) {
          return {
            content: [{ type: "text", text: "Belum ada tab aktif atau tersimpan." }],
          };
        }
        let out = "📑 DASHBOARD TAB MULTITASKING:\n";
        for (const t of tabs) {
          const icon = t.status === "running" ? "🟢" : "⚪";
          const exitStr = t.exit !== null && t.exit !== undefined ? ` (exit ${t.exit})` : "";
          out += `  • [${t.target.toUpperCase()}] ${t.name} (${t.id}) -> ${icon} ${t.status}${exitStr} | ${t.command}\n`;
        }
        return {
          content: [{ type: "text", text: out }],
        };
      }

      case "tab_attach": {
        const query = String(a.name || "").trim();
        const res = await tabManager.getLogs(query);
        if (!res) {
          return {
            isError: true,
            content: [{ type: "text", text: `Tab "${query}" tidak ditemukan.` }],
          };
        }
        let lifecycleNotice = "";
        if (res.tab.status === "exited") {
          lifecycleNotice = `\n\n💡 [LIFECYCLE RULE]: Tab ini sudah selesai (exit ${res.tab.exit ?? 0}). Jika hasil sudah diperiksa dan tab tidak lagi digunakan (seperti install/build), segera tutup dengan tab_kill atau bersihkan dengan tab_clean.`;
        }
        return {
          content: [
            {
              type: "text",
              text: `📋 LOG TAB "${res.tab.name}" [${res.tab.target.toUpperCase()}] status: ${res.tab.status} exit: ${res.tab.exit ?? "-"}\n---------------------------------------------------------------\n${res.logs || "(belum ada output)"}\n---------------------------------------------------------------${lifecycleNotice}`,
            },
          ],
        };
      }

      case "tab_kill": {
        const query = String(a.name || "").trim();
        const res = await tabManager.killTab(query);
        return {
          content: [{ type: "text", text: res.message }],
        };
      }

      case "tab_clean": {
        const count = tabManager.cleanTabs();
        return {
          content: [{ type: "text", text: `🧹 ${count} tab selesai berhasil dibersihkan.` }],
        };
      }

      case "vps_exec": {
        const cmd = String(a.command || "").trim();
        try {
          const cfg = loadCliConfig();
          interface ExecResponse {
            exit: number;
            stdout?: string;
            stderr?: string;
          }
          const res = await callMcpTool<ExecResponse>(cfg, "exec.run", {
            project: a.project || "smoke-app",
            command: cmd,
          });
          const text = (res.stdout || "") + (res.stderr ? `\n[STDERR]:\n${res.stderr}` : "");
          return {
            content: [{ type: "text", text: text || `(selesai dengan exit code ${res.exit})` }],
          };
        } catch (err: any) {
          return {
            isError: true,
            content: [{ type: "text", text: `Error VPS execution: ${err.message}` }],
          };
        }
      }

      default:
        throw new Error(`Tool "${name}" tidak dikenali.`);
    }
  });

  return server;
}

export async function runMcpServer(transport?: Transport): Promise<Server> {
  const server = createMcpServer();
  const t = transport || new StdioServerTransport();
  await server.connect(t);
  return server;
}
