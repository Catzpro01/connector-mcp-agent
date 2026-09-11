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

export interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

export interface Relation {
  from: string;
  to: string;
  relationType: string;
}

export interface KnowledgeGraphData {
  entities: Entity[];
  relations: Relation[];
}

export interface SubGraphView {
  entities: Entity[];
  relations: Relation[];
}

export interface CodeMatch {
  file: string;
  line: number;
  kind?: string;
  symbolName?: string;
  preview: string;
  score: number;
}

export interface SymbolInfo {
  name: string;
  kind: string;
  file: string;
  line: number;
  signature: string;
}

export async function getKnowledgeGraph(cfg: CliConfig, project: string): Promise<KnowledgeGraphData> {
  try {
    const res = await fetch(`${cfg.url}/api/projects/${project}/memory/graph`);
    if (!res.ok) return { entities: [], relations: [] };
    return (await res.json()) as KnowledgeGraphData;
  } catch {
    return { entities: [], relations: [] };
  }
}

export async function searchKnowledgeGraph(cfg: CliConfig, project: string, query: string): Promise<SubGraphView> {
  try {
    const res = await fetch(`${cfg.url}/api/projects/${project}/memory/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return { entities: [], relations: [] };
    return (await res.json()) as SubGraphView;
  } catch {
    return { entities: [], relations: [] };
  }
}

export async function openKnowledgeNodes(cfg: CliConfig, project: string, names: string[]): Promise<SubGraphView> {
  try {
    const res = await fetch(`${cfg.url}/api/projects/${project}/memory/nodes/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names }),
    });
    if (!res.ok) return { entities: [], relations: [] };
    return (await res.json()) as SubGraphView;
  } catch {
    return { entities: [], relations: [] };
  }
}

export async function createKnowledgeEntities(cfg: CliConfig, project: string, entities: Entity[]): Promise<boolean> {
  try {
    const res = await fetch(`${cfg.url}/api/projects/${project}/memory/entities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entities }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function createKnowledgeRelations(cfg: CliConfig, project: string, relations: Relation[]): Promise<boolean> {
  try {
    const res = await fetch(`${cfg.url}/api/projects/${project}/memory/relations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relations }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function addKnowledgeObservations(
  cfg: CliConfig,
  project: string,
  entityName: string,
  contents: string[],
): Promise<{ success: boolean; addedObservations?: string[] }> {
  try {
    const res = await fetch(`${cfg.url}/api/projects/${project}/memory/observations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityName, contents }),
    });
    if (!res.ok) return { success: false };
    return (await res.json()) as { success: boolean; addedObservations?: string[] };
  } catch {
    return { success: false };
  }
}

export async function searchCode(cfg: CliConfig, project: string, query: string, limit = 25): Promise<CodeMatch[]> {
  try {
    const res = await fetch(`${cfg.url}/api/projects/${project}/code/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { matches: CodeMatch[] };
    return data.matches || [];
  } catch {
    return [];
  }
}

export async function findSymbol(cfg: CliConfig, project: string, name: string): Promise<SymbolInfo[]> {
  try {
    const res = await fetch(`${cfg.url}/api/projects/${project}/code/symbol?name=${encodeURIComponent(name)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { symbols: SymbolInfo[] };
    return data.symbols || [];
  } catch {
    return [];
  }
}

export async function getFileOutline(cfg: CliConfig, project: string, file: string): Promise<SymbolInfo[]> {
  try {
    const res = await fetch(`${cfg.url}/api/projects/${project}/code/outline?file=${encodeURIComponent(file)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { symbols: SymbolInfo[] };
    return data.symbols || [];
  } catch {
    return [];
  }
}

export async function reindexCode(cfg: CliConfig, project: string): Promise<{ success: boolean; scannedFiles?: number; indexedSymbols?: number }> {
  try {
    const res = await fetch(`${cfg.url}/api/projects/${project}/code/reindex`, { method: "POST" });
    if (!res.ok) return { success: false };
    return (await res.json()) as { success: boolean; scannedFiles?: number; indexedSymbols?: number };
  } catch {
    return { success: false };
  }
}

