import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMcpServer } from "../src/mcp-server.js";

describe("native MCP server tools integration (Ticket 03)", () => {
  it("exposes all 6 canonical tools via JSON-RPC 2.0 protocol", async () => {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: "agent-test-client", version: "1.0.0" }, { capabilities: {} });

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.listTools();
    const toolNames = res.tools.map((t) => t.name);

    expect(toolNames).toContain("tab_new");
    expect(toolNames).toContain("tab_list");
    expect(toolNames).toContain("tab_attach");
    expect(toolNames).toContain("tab_kill");
    expect(toolNames).toContain("tab_clean");
    expect(toolNames).toContain("vps_exec");
    expect(toolNames.length).toBe(6);

    await client.close();
  });

  it("spawns tab_new and immediately returns task ID without blocking", async () => {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "agent-test-client", version: "1.0.0" }, { capabilities: {} });

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const startTs = Date.now();
    const callRes = await client.callTool({
      name: "tab_new",
      arguments: {
        name: "agent-build-task",
        command: "echo mcp_build_start && sleep 1 && echo mcp_build_done",
        target: "laptop",
      },
    });
    const elapsed = Date.now() - startTs;

    expect(elapsed).toBeLessThan(500);
    const content = (callRes.content as Array<{ type: string; text: string }>)[0].text;
    expect(content).toContain("Tab Laptop \"agent-build-task\"");
    expect(content).toContain("berhasil dibuka");

    // List tabs
    const listRes = await client.callTool({ name: "tab_list", arguments: {} });
    const listContent = (listRes.content as Array<{ type: string; text: string }>)[0].text;
    expect(listContent).toContain("agent-build-task");

    // Attach to tab
    const attachRes = await client.callTool({
      name: "tab_attach",
      arguments: { name: "agent-build-task" },
    });
    const attachContent = (attachRes.content as Array<{ type: string; text: string }>)[0].text;
    expect(attachContent).toContain("agent-build-task");

    // Kill tab
    const killRes = await client.callTool({
      name: "tab_kill",
      arguments: { name: "agent-build-task" },
    });
    const killContent = (killRes.content as Array<{ type: string; text: string }>)[0].text;
    expect(killContent).toContain("berhasil dihentikan");

    // Clean exited tabs
    const cleanRes = await client.callTool({ name: "tab_clean", arguments: {} });
    const cleanContent = (cleanRes.content as Array<{ type: string; text: string }>)[0].text;
    expect(cleanContent).toContain("berhasil dibersihkan");

    await client.close();
  }, 35000);

  it("executes vps_exec over HTTP streamable MCP directly", async () => {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "agent-test-client", version: "1.0.0" }, { capabilities: {} });

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({
      name: "vps_exec",
      arguments: {
        command: "echo vps_mcp_tool_pure_http_ok",
      },
    });

    const content = (res.content as Array<{ type: string; text: string }>)[0].text;
    expect(content).toContain("vps_mcp_tool_pure_http_ok");

    await client.close();
  });

  it("verifies project root .mcp.json registration for connector-cli mcp", () => {
    const candidatePaths = [
      "c:\\Users\\user\\OneDrive\\Desktop\\n8n_rust v1.0\\.mcp.json",
      resolve(process.cwd(), ".mcp.json"),
      resolve(process.cwd(), "../.mcp.json"),
    ];
    const rootMcpPath = candidatePaths.find((p) => existsSync(p));
    expect(rootMcpPath).toBeDefined();

    const raw = readFileSync(rootMcpPath!, "utf8").replace(/^\uFEFF/, "");
    const config = JSON.parse(raw);
    expect(config.mcpServers["multitasking-tabs"]).toBeDefined();
    expect(config.mcpServers["multitasking-tabs"].command).toBe("connector-cli");
    expect(config.mcpServers["multitasking-tabs"].args).toContain("mcp");
  });
});
