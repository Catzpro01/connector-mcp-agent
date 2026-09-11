import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * The Session Disk is created when a session starts and deleted when it
 * ends, so downloaded skills never go stale (ADR 0009).
 */
export function createSessionDisk(): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), `connector-session-${randomBytes(4).toString("hex")}-`));
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // Best effort; the OS temp dir will reclaim it.
    }
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  return { path, cleanup };
}
