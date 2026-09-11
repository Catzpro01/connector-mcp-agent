import { describe, expect, it } from "vitest";
import { mcpServerEntry, loadCliConfig } from "../src/config.js";
import { registerMcpConfig } from "../src/mcp-config.js";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("cli config", () => {
  it("requires CONNECTOR_URL and CONNECTOR_API_KEY", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "connector-empty-"));
    expect(() => loadCliConfig({}, emptyDir)).toThrow("CONNECTOR_URL");
    const cfg = loadCliConfig({ CONNECTOR_URL: "https://vps.example.com/", CONNECTOR_API_KEY: "k" }, emptyDir);
    expect(cfg.url).toBe("https://vps.example.com");
  });

  it("builds the MCP server entry", () => {
    const entry = mcpServerEntry({ url: "https://vps.example.com", apiKey: "k" });
    expect(entry.connector).toMatchObject({ type: "http", url: "https://vps.example.com/mcp" });
  });
});

describe("mcp config registration", () => {
  it("writes .mcp.json and merges with existing servers", () => {
    const dir = mkdtempSync(join(tmpdir(), "connector-cli-"));
    const cfg = { url: "https://vps.example.com", apiKey: "k" };
    const first = registerMcpConfig(cfg, dir);
    expect(first.created).toBe(true);
    const second = registerMcpConfig(cfg, dir, "other-agent");
    expect(second.created).toBe(false);
    const parsed = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8")) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(parsed.mcpServers)).toEqual(["connector", "other-agent"]);
  });

  it("refuses to overwrite invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "connector-cli-"));
    writeFileSync(join(dir, ".mcp.json"), "{not json");
    expect(() => registerMcpConfig({ url: "u", apiKey: "k" }, dir)).toThrow("not valid JSON");
  });
});
