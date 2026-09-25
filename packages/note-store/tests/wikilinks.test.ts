import { describe, expect, it } from "vitest";
import { extractWikilinks, normalizeConceptName } from "../src/wikilinks";

describe("normalizeConceptName", () => {
  it("ignores case, outer and inner whitespace", () => {
    expect(normalizeConceptName("  Chain   Rule ")).toBe("chain rule");
  });
});

describe("extractWikilinks", () => {
  it("finds plain links in order, with offsets", () => {
    const md = "See [[Chain Rule]] and [[Derivatives]].";
    const links = extractWikilinks(md);
    expect(links.map((l) => l.target)).toEqual(["Chain Rule", "Derivatives"]);
    expect(md.slice(links[0]!.index, links[0]!.index + 2)).toBe("[[");
  });

  it("parses aliases", () => {
    const [l] = extractWikilinks("[[Chain Rule|the chain thing]]");
    expect(l).toMatchObject({ target: "Chain Rule", alias: "the chain thing", key: "chain rule" });
  });

  it("keeps duplicates (graph dedupes, parser doesn't)", () => {
    expect(extractWikilinks("[[A]] [[a]]")).toHaveLength(2);
  });

  it("ignores links in fenced and inline code", () => {
    const md = "real [[Yes]]\n```\n[[No1]]\n```\nand `[[No2]]`\n~~~\n[[No3]]\n~~~\nafter [[Also Yes]]";
    expect(extractWikilinks(md).map((l) => l.target)).toEqual(["Yes", "Also Yes"]);
  });

  it("ignores empty, unclosed, and multi-line links", () => {
    expect(extractWikilinks("[[ ]] [[oops\nnope]] [[unclosed")).toEqual([]);
  });

  it("supports names with # (no heading syntax on purpose)", () => {
    expect(extractWikilinks("[[C# Generics]]")[0]?.target).toBe("C# Generics");
  });
});
