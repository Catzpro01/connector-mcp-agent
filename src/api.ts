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

export async function authWithServer(
  cfg: CliConfig,
  agentName: string,
  token?: string,
): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const res = await fetch(`${cfg.url}/api/registry/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName, token }),
    });
    const data = await res.json();
    return data as { success: boolean; token?: string; error?: string };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function sendHeartbeat(
  cfg: CliConfig,
  agentName: string,
  token: string,
  opts?: { status?: "IDLE" | "BUSY" | "CHATTING"; project?: string; task?: string; gen?: number },
): Promise<boolean> {
  try {
    const res = await fetch(`${cfg.url}/api/registry/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName, token, ...opts }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function releaseServerSession(cfg: CliConfig, agentName: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${cfg.url}/api/registry/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName, token }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface ForumChannel {
  number: number;
  title: string;
  state: string;
  comments: any[];
}

export interface ForumComment {
  id: string;
  author: { login: string };
  body: string;
  createdAt: string;
}

export async function getForumChannels(cfg: CliConfig): Promise<ForumChannel[]> {
  try {
    const res = await fetch(`${cfg.url}/api/forum/channels`);
    if (!res.ok) return [];
    const data = (await res.json()) as { channels?: ForumChannel[] };
    return data.channels || [];
  } catch {
    return [];
  }
}

export async function getForumComments(cfg: CliConfig, issueNum: number): Promise<ForumComment[]> {
  try {
    const res = await fetch(`${cfg.url}/api/forum/channels/${issueNum}/comments`);
    if (!res.ok) return [];
    const data = (await res.json()) as { comments?: ForumComment[] };
    return data.comments || [];
  } catch {
    return [];
  }
}

export async function postForumComment(
  cfg: CliConfig,
  issueNum: number,
  message: string,
): Promise<{ success: boolean; url?: string }> {
  try {
    const res = await fetch(`${cfg.url}/api/forum/channels/${issueNum}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: message }),
    });
    if (!res.ok) return { success: false };
    return (await res.json()) as { success: boolean; url?: string };
  } catch {
    return { success: false };
  }
}

