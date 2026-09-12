import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOCAL_DISK_DIR } from "./agent-name.js";
import { CliConfig } from "./config.js";

export interface AgentPolicy {
  sessionPersistence: boolean;
  cacheWarmup: boolean;
  backgroundBackup: boolean;
  peerSync: boolean;
  maintenanceMode: boolean;
  lockMessage: string;
  updatedAt: string;
}

export const DEFAULT_AGENT_POLICY: AgentPolicy = {
  sessionPersistence: true,
  cacheWarmup: true,
  backgroundBackup: true,
  peerSync: true,
  maintenanceMode: false,
  lockMessage: "Sesi dijeda sementara oleh administrator.",
  updatedAt: new Date().toISOString(),
};

export class ClientPolicyManager {
  private static instance: ClientPolicyManager;
  private currentPolicy: AgentPolicy;
  private policyPath: string;

  private constructor() {
    this.policyPath = join(LOCAL_DISK_DIR, "policy.json");
    this.currentPolicy = this.loadLocal();
  }

  public static getInstance(): ClientPolicyManager {
    if (!ClientPolicyManager.instance) {
      ClientPolicyManager.instance = new ClientPolicyManager();
    }
    return ClientPolicyManager.instance;
  }

  private loadLocal(): AgentPolicy {
    if (existsSync(this.policyPath)) {
      try {
        const raw = JSON.parse(readFileSync(this.policyPath, "utf8"));
        return { ...DEFAULT_AGENT_POLICY, ...raw };
      } catch {}
    }
    return { ...DEFAULT_AGENT_POLICY };
  }

  public getPolicy(): AgentPolicy {
    return { ...this.currentPolicy };
  }

  public applyServerPolicy(policy?: Partial<AgentPolicy>): void {
    if (!policy) return;
    this.currentPolicy = {
      ...this.currentPolicy,
      ...policy,
    };
    try {
      mkdirSync(LOCAL_DISK_DIR, { recursive: true });
      writeFileSync(this.policyPath, JSON.stringify(this.currentPolicy, null, 2), "utf8");
    } catch {}
  }

  public async fetchServerPolicy(cfg: CliConfig): Promise<AgentPolicy> {
    try {
      const res = await fetch(`${cfg.url}/api/agent/policy`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = (await res.json()) as AgentPolicy;
        this.applyServerPolicy(data);
        return this.getPolicy();
      }
    } catch {}
    return this.getPolicy();
  }
}

export const clientPolicy = ClientPolicyManager.getInstance();
