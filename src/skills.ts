import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A manifest skill string is "<owner>/<repo>/<path-to-skill>", e.g.
 * "mattpocock/skills/engineering/grill-with-docs". The CLI downloads the
 * SKILL.md (and nearby files) from GitHub into the Session Disk.
 */
export interface DownloadedSkill {
  source: string;
  name: string;
  files: string[];
}

const SKILL_FILES = ["SKILL.md", "CONTEXT-FORMAT.md", "ADR-FORMAT.md"];

export function parseSkillSource(source: string): { owner: string; repo: string; path: string; name: string } {
  const parts = source.split("/").filter(Boolean);
  if (parts.length < 3) throw new Error(`Invalid skill source "${source}": expected <owner>/<repo>/<path-to-skill>.`);
  const [owner, repo, ...rest] = parts;
  return { owner, repo, path: rest.join("/"), name: rest[rest.length - 1] ?? source };
}

async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: { "user-agent": "connector-cli" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${url}`);
  return res.text();
}

async function downloadSkillFile(owner: string, repo: string, path: string, file: string, destDir: string): Promise<string[]> {
  const saved: string[] = [];
  for (const branch of ["main", "master"]) {
    const content = await fetchText(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}/${file}`);
    if (content !== null) {
      writeFileSync(join(destDir, file), content);
      saved.push(file);
      return saved;
    }
  }
  return saved;
}

export async function downloadSkill(source: string, sessionDisk: string): Promise<DownloadedSkill> {
  const { owner, repo, path, name } = parseSkillSource(source);
  const destDir = join(sessionDisk, "skills", name);
  mkdirSync(destDir, { recursive: true });
  const files: string[] = [];
  for (const file of SKILL_FILES) {
    files.push(...(await downloadSkillFile(owner, repo, path, file, destDir)));
  }
  if (!files.includes("SKILL.md")) {
    throw new Error(`Skill "${source}" has no SKILL.md at ${owner}/${repo}/${path} (tried main and master).`);
  }
  return { source, name, files };
}

export async function downloadSkills(manifest: { skills: string[] }, sessionDisk: string): Promise<DownloadedSkill[]> {
  const results: DownloadedSkill[] = [];
  for (const source of manifest.skills) {
    results.push(await downloadSkill(source, sessionDisk));
  }
  return results;
}
