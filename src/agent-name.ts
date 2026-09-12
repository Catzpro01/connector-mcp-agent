import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

/**
 * The Local Disk is the agent's persistent directory on its own machine:
 * the Agent Name (login, no password) and the Local Tasks (ADR 0011/0012).
 */
export const LOCAL_DISK_DIR = join(homedir(), ".connector-cli");

export interface StoredConfig {
  agentName?: string;
  url?: string;
  apiKey?: string;
  defaultProject?: string;
}

export function localDiskConfigPath(dir: string = LOCAL_DISK_DIR): string {
  return join(dir, "config.json");
}

export function readStoredConfig(dir: string = LOCAL_DISK_DIR): StoredConfig {
  try {
    const file = localDiskConfigPath(dir);
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, "utf8")) as StoredConfig;
  } catch {
    return {};
  }
}

export function saveStoredConfig(updates: Partial<StoredConfig>, dir: string = LOCAL_DISK_DIR): StoredConfig {
  mkdirSync(dir, { recursive: true });
  const current = readStoredConfig(dir);
  const next = { ...current, ...updates };
  writeFileSync(localDiskConfigPath(dir), JSON.stringify(next, null, 2) + "\n");
  return next;
}

export function readStoredAgentName(dir: string = LOCAL_DISK_DIR): string | undefined {
  const conf = readStoredConfig(dir);
  return typeof conf.agentName === "string" && conf.agentName.trim() ? conf.agentName : undefined;
}

export function saveAgentName(name: string, dir: string = LOCAL_DISK_DIR): void {
  saveStoredConfig({ agentName: name }, dir);
}

export function readStoredSessionToken(agentName: string, dir: string = LOCAL_DISK_DIR): string | undefined {
  const conf = readStoredConfig(dir);
  return (conf as any)[`token_${agentName.toLowerCase()}`];
}

export function saveStoredSessionToken(agentName: string, token: string | undefined, dir: string = LOCAL_DISK_DIR): void {
  saveStoredConfig({ [`token_${agentName.toLowerCase()}`]: token } as any, dir);
}

/** Asks once for the login name; automatically falls back to system username if non-interactive or skipped. */
export async function promptAgentName(): Promise<string> {
  let fallback = "user";
  try {
    fallback = userInfo().username || process.env.USERNAME || process.env.USER || "user";
  } catch {}

  if (!process.stdin.isTTY) {
    return fallback;
  }

  try {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const raw = await rl.question(`Nama agent [default: ${fallback}]: `);
    rl.close();
    return raw.trim() || fallback;
  } catch {
    return fallback;
  }
}

