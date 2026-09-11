import { readStoredAgentName, readStoredConfig } from "./agent-name.js";

export const DEFAULT_CONNECTOR_URL = "http://your-vps-ip:3210";

export interface CliConfig {
  url: string;
  apiKey?: string;
  agentName?: string;
}

export function loadCliConfig(env: NodeJS.ProcessEnv = process.env, configDir?: string): CliConfig {
  const stored = readStoredConfig(configDir);
  const url = env.CONNECTOR_URL || stored.url || (configDir === undefined ? DEFAULT_CONNECTOR_URL : undefined);
  const apiKey = env.CONNECTOR_API_KEY || stored.apiKey || "";
  if (!url) {
    throw new Error(
      [
        "CONNECTOR_URL belum disetel.",
        "Setel melalui environment variabel atau jalankan 'connector-cli setting' untuk menyimpannya.",
      ].join("\n"),
    );
  }
  return {
    url: url.replace(/\/+$/, ""),
    apiKey,
    agentName: env.CONNECTOR_AGENT?.trim() || readStoredAgentName(configDir) || "agent",
  };
}


export function mcpServerEntry(cfg: CliConfig, name = "connector"): Record<string, unknown> {
  const headers: Record<string, string> = {
    ...(cfg.apiKey ? { "X-API-Key": cfg.apiKey } : {}),
    ...(cfg.agentName ? { "X-Agent-Name": cfg.agentName } : {}),
  };
  return {
    [name]: {
      type: "http",
      url: `${cfg.url}/mcp`,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    },
  };
}
