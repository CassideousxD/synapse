import { describe, expect, it } from "vitest";
import { buildGraph, getBacklinks, getOutgoing, unresolvedId } from "../src/graph";

const notes = [
  { conceptId: "c1", title: "Chain Rule", markdown: "Needs [[derivatives]] and [[Chain Rule]] and [[Limits]]." },
  { conceptId: "c2", title: "Derivatives", markdown: "Related: [[Chain Rule]] [[chain rule]]" },
];

describe("buildGraph", () => {
  const g = buildGraph(notes);

  it("resolves links case-insensitively to concept ids", () => {
    expect(getOutgoing(g, "c1")).toContain("c2");
  });

  it("creates ghost nodes for links with no note", () => {
    const ghost = g.nodes.find((n) => n.id === unresolvedId("limits"));
    expect(ghost).toEqual({ id: "unresolved:limits", title: "Limits", exists: false });
  });

  it("drops self-links and dedupes edges", () => {
    expect(getOutgoing(g, "c1")).not.toContain("c1");
    expect(g.edges.filter((e) => e.from === "c2" && e.to === "c1")).toHaveLength(1);
  });

  it("computes backlinks", () => {
    expect(getBacklinks(g, "c1")).toEqual(["c2"]);
  });

  it("throws on duplicate titles", () => {
    expect(() =>
      buildGraph([
        { conceptId: "a", title: "X", markdown: "" },
        { conceptId: "b", title: " x ", markdown: "" },
      ]),
    ).toThrow(/Duplicate note title/);
  });
});
