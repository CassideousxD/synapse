import { extractWikilinks, normalizeConceptName } from "./wikilinks";

export interface GraphNoteInput {
  conceptId: string;
  title: string;
  markdown: string;
}

export interface GraphNode {
  id: string;
  title: string;
  /** false = someone links to it but the student has no note for it yet */
  exists: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface NoteGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const unresolvedId = (key: string) => `unresolved:${key}`;

export function buildGraph(notes: GraphNoteInput[]): NoteGraph {
  // title -> conceptId. Duplicate titles are a data bug upstream: fail loudly.
  const byKey = new Map<string, GraphNoteInput>();
  for (const n of notes) {
    const key = normalizeConceptName(n.title);
    const clash = byKey.get(key);
    if (clash) {
      throw new Error(
        `Duplicate note title "${n.title}" (concepts ${clash.conceptId} and ${n.conceptId})`,
      );
    }
    byKey.set(key, n);
  }

  const nodes = new Map<string, GraphNode>();
  for (const n of notes) {
    nodes.set(n.conceptId, { id: n.conceptId, title: n.title, exists: true });
  }

  const edgeKeys = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const n of notes) {
    for (const link of extractWikilinks(n.markdown)) {
      const target = byKey.get(link.key);
      let toId: string;
      if (target) {
        toId = target.conceptId;
      } else {
        toId = unresolvedId(link.key);
        if (!nodes.has(toId)) {
          nodes.set(toId, { id: toId, title: link.target, exists: false });
        }
      }
      if (toId === n.conceptId) continue; // drop self-links
      const ek = `${n.conceptId}\u0000${toId}`;
      if (edgeKeys.has(ek)) continue; // dedupe
      edgeKeys.add(ek);
      edges.push({ from: n.conceptId, to: toId });
    }
  }

  return { nodes: [...nodes.values()], edges };
}

export function getOutgoing(graph: NoteGraph, id: string): string[] {
  return graph.edges.filter((e) => e.from === id).map((e) => e.to);
}

export function getBacklinks(graph: NoteGraph, id: string): string[] {
  return graph.edges.filter((e) => e.to === id).map((e) => e.from);
}
