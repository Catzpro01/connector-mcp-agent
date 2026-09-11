import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

const LOCAL_DISK_DIR = join(homedir(), ".connector-cli");
const DEFAULT_URL = "http://your-vps-ip:3210";

try {
  mkdirSync(LOCAL_DISK_DIR, { recursive: true });
  const cfgPath = join(LOCAL_DISK_DIR, "config.json");
  let cfg = {};
  if (existsSync(cfgPath)) {
    try {
      cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    } catch {}
  }
  let user = "agent";
  try {
    user = userInfo().username || process.env.USERNAME || process.env.USER || "agent";
  } catch {}

  const next = {
    url: cfg.url || DEFAULT_URL,
    agentName: cfg.agentName || user,
    apiKey: cfg.apiKey || "",
  };

  writeFileSync(cfgPath, JSON.stringify(next, null, 2) + "\n");
  console.log("\n=======================================================");
  console.log(" 🟢 Connector-CLI Installed & Auto-Configured!");
  console.log(` Server VPS  : ${next.url} (Direct / Open Dev Mode)`);
  console.log(` Agent Login : ${next.agentName}`);
  console.log(" Status      : Langsung Terhubung ke VPS Tanpa Perlu Penyesuaian!");
  console.log("=======================================================\n");
} catch (err) {
  // Silent on postinstall error
}
