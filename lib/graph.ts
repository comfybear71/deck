import type { GraphData, GraphEdge, GraphNode } from "./types";

/**
 * v0 project graph — a static, hand-seeded map of French Deck's sibling
 * projects and how they relate (see data/graph.json + the README's
 * "Graph (v0 map)" section). No backend, no live discovery: this is a
 * glanceable map, not an execution graph. Looping/agents/real ComfyUI-style
 * execution are explicitly out of scope for v0.
 */

export function findNode(nodes: GraphNode[], id: string): GraphNode | undefined {
  return nodes.find((n) => n.id === id);
}

/** Edges that start at this node, in seed order. */
export function edgesFrom(edges: GraphEdge[], nodeId: string): GraphEdge[] {
  return edges.filter((e) => e.from === nodeId);
}

/** Render order: projects first, the placeholder next, the hub last — the hub
 * reads as "everything funnels down into Deck" in a vertical mobile stack.
 * Within the project rank, `featured` nodes (Budju) sort first — that's how
 * Budju stays the primary node ahead of Skidmarks / AIG!itch without a
 * separate `kind`. */
export function orderedNodes(data: GraphData): GraphNode[] {
  const rank: Record<GraphNode["kind"], number> = {
    project: 0,
    placeholder: 1,
    hub: 2,
  };
  return [...data.nodes].sort((a, b) => {
    const rankDiff = rank[a.kind] - rank[b.kind];
    if (rankDiff !== 0) return rankDiff;
    return Number(Boolean(b.featured)) - Number(Boolean(a.featured));
  });
}
