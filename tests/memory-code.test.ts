import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  getKnowledgeGraph,
  searchKnowledgeGraph,
  openKnowledgeNodes,
  createKnowledgeEntities,
  createKnowledgeRelations,
  searchCode,
  findSymbol,
  getFileOutline,
  reindexCode,
} from "../src/api.js";
import { importProjectMemorySilent } from "../src/memory-sync.js";
import { loadCliConfig } from "../src/config.js";

describe("Agent Client MCP Memory & Cursor-Style Code Index API", () => {
  const cfg = loadCliConfig();
  const project = "smoke-app";

  it("creates entities and retrieves knowledge graph from server", async () => {
    const ok = await createKnowledgeEntities(cfg, project, [
      {
        name: "TestService",
        entityType: "service",
        observations: ["Test observation 1", "Handles test workloads"],
      },
    ]);
    expect(ok).toBe(true);

    const graph = await getKnowledgeGraph(cfg, project);
    expect(graph.entities.length).toBeGreaterThan(0);
    const found = graph.entities.find((e) => e.name.toLowerCase() === "testservice");
    expect(found).toBeDefined();
    expect(found?.observations).toContain("Test observation 1");
  });

  it("creates relations and performs 1-hop sub-graph search", async () => {
    await createKnowledgeEntities(cfg, project, [
      { name: "ServiceAlpha", entityType: "service", observations: ["Alpha component"] },
      { name: "ServiceBeta", entityType: "service", observations: ["Beta component"] },
    ]);

    await createKnowledgeRelations(cfg, project, [
      { from: "ServiceAlpha", to: "ServiceBeta", relationType: "calls" },
    ]);

    const subGraph = await searchKnowledgeGraph(cfg, project, "Alpha component");
    expect(subGraph.entities.length).toBeGreaterThan(0);
    expect(subGraph.entities.map((e) => e.name)).toContain("ServiceAlpha");
    expect(subGraph.relations.some((r) => r.from === "ServiceAlpha" && r.to === "ServiceBeta")).toBe(true);
  });

  it("opens specific nodes with connected neighborhood", async () => {
    const res = await openKnowledgeNodes(cfg, project, ["ServiceAlpha"]);
    expect(res.entities.map((e) => e.name)).toContain("ServiceAlpha");
    expect(res.entities.map((e) => e.name)).toContain("ServiceBeta");
  });

  it("performs instant code search and symbol lookup on VPS workspace", async () => {
    // Trigger reindex first
    const reindexRes = await reindexCode(cfg, project);
    expect(reindexRes.success).toBe(true);

    // Search code
    const matches = await searchCode(cfg, project, "node", 10);
    expect(Array.isArray(matches)).toBe(true);

    // Find symbol
    const symbols = await findSymbol(cfg, project, "app");
    expect(Array.isArray(symbols)).toBe(true);
  });

  it("imports project memory silently into local session disk with markdown snapshot", async () => {
    const importRes = await importProjectMemorySilent(cfg, project, "test-agent");
    expect(importRes.success).toBe(true);
    expect(importRes.entityCount).toBeGreaterThan(0);
    expect(existsSync(join(importRes.localPath, "knowledge-graph.json"))).toBe(true);
    expect(existsSync(join(importRes.localPath, "MEMORY_SNAPSHOT.md"))).toBe(true);
  });
});
