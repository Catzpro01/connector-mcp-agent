import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

const LOCAL_DISK_DIR = join(homedir(), ".connector-cli");

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
    url: cfg.url || "",
    agentName: cfg.agentName || user,
    apiKey: cfg.apiKey || "",
  };

  writeFileSync(cfgPath, JSON.stringify(next, null, 2) + "\n");
  console.log("\n=======================================================");
  console.log(" 🟢 Connector-CLI Installed!");
  console.log(` Agent Name  : ${next.agentName}`);
  if (!next.url) {
    console.log(" ⚠️  Server URL belum dikonfigurasi.");
    console.log("    Jalankan: connector-cli setting");
  } else {
    console.log(` Server URL  : ${next.url}`);
  }
  console.log("=======================================================\n");
} catch (err) {
  // Silent on postinstall error
}
