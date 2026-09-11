import type { CliConfig } from "./config.js";

export interface ProjectSummary {
  slug: string;
  name: string;
  description?: string;
  generation: number;
  lastMilestone?: { name: string; status: string; at: string };
  remote?: string;
}

export interface InheritanceView {
  generation: number;
  summary: string;
  openTasks: Array<{ task: string; command?: string }>;
  skills: string[];
}

export async function apiGet<T>(cfg: CliConfig, path: string): Promise<T> {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(cfg.apiKey ? { "X-API-Key": cfg.apiKey } : {}),
    ...(cfg.agentName ? { "X-Agent-Name": cfg.agentName } : {}),
  };
  const res = await fetch(`${cfg.url}${path}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Connector returned ${res.status} for ${path}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export function listProjects(cfg: CliConfig): Promise<{ projects: ProjectSummary[] }> {
  return apiGet<{ projects: ProjectSummary[] }>(cfg, "/api/projects");
}

export function getInheritance(cfg: CliConfig, slug: string): Promise<InheritanceView> {
  return apiGet<InheritanceView>(cfg, `/api/projects/${encodeURIComponent(slug)}/inherit`);
}

export function getManifest(cfg: CliConfig, slug: string): Promise<{ skills: string[] }> {
  return apiGet<{ skills: string[] }>(cfg, `/api/projects/${encodeURIComponent(slug)}/manifest`);
}

export async function callMcpTool<T = unknown>(cfg: CliConfig, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(cfg.apiKey ? { "X-API-Key": cfg.apiKey } : {}),
    ...(cfg.agentName ? { "X-Agent-Name": cfg.agentName } : {}),
  };
  const res = await fetch(`${cfg.url}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`MCP error ${res.status}: ${txt.slice(0, 300)}`);
  }
  const text = await res.text();
  // Handle SSE framing (event: message\ndata: { ... })
  let jsonStr = text;
  const dataMatch = text.match(/data:\s*(\{.*\})/);
  if (dataMatch) {
    jsonStr = dataMatch[1];
  }
  const parsed = JSON.parse(jsonStr);
  if (parsed.error) {
    throw new Error(parsed.error.message || JSON.stringify(parsed.error));
  }
  const content = parsed.result?.content?.[0]?.text;
  if (!content) return parsed.result as T;
  try {
    return JSON.parse(content) as T;
  } catch {
    return content as unknown as T;
  }
}

