import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mcpServerEntry, type CliConfig } from "./config.js";

/**
 * Registers the Connector in the agent's MCP configuration: writes or
 * updates the project-level .mcp.json (used by Claude Code and compatible
 * agents), merging with any existing servers instead of overwriting.
 */
export function registerMcpConfig(cfg: CliConfig, cwd: string, name = "connector"): { path: string; created: boolean } {
  const path = join(cwd, ".mcp.json");
  const created = !existsSync(path);
  let existing: Record<string, unknown> = {};
  if (!created) {
    try {
      existing = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      throw new Error(`Existing ${path} is not valid JSON; refusing to overwrite it. Fix or remove it first.`);
    }
  }
  const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;
  servers[name] = mcpServerEntry(cfg, name)[name];
  writeFileSync(path, JSON.stringify({ mcpServers: servers }, null, 2) + "\n");
  return { path, created };
}
