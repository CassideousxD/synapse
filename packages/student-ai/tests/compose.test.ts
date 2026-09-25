import { describe, expect, it } from "vitest";
import { composeNote, extractPreviousBody, isPreserved, sanitizeSection } from "../src/compose";

const name = "Chain Rule";
const first = () => composeNote({ conceptName: name, sectionBody: "You applied (fg)' = f'g'. That's wrong.", updateNumber: 1, date: "2026-09-20" });

describe("composeNote", () => {
  it("builds a first note: title, Update 1 heading, body, no separator", () => {
    expect(first()).toBe("# Chain Rule\n\n## Update 1 · 2026-09-20\n\nYou applied (fg)' = f'g'. That's wrong.");
  });

  it("puts the new section on top and keeps the previous text verbatim below", () => {
    const v1 = first();
    const v2 = composeNote({ conceptName: name, sectionBody: "Now you get the product rule.", updateNumber: 2, date: "2026-09-27", previousMarkdown: v1 });
    expect(v2.indexOf("Update 2")).toBeLessThan(v2.indexOf("Update 1"));
    expect(v2).toContain("You applied (fg)' = f'g'. That's wrong.");
    expect(v2.match(/^# Chain Rule$/gm)).toHaveLength(1);
    expect(isPreserved(v1, v2, name)).toBe(true);
  });

  it("keeps the whole history across many updates", () => {
    let note = first();
    for (let n = 2; n <= 4; n++) {
      const next = composeNote({ conceptName: name, sectionBody: `insight ${n}`, updateNumber: n, date: "2026-10-01", previousMarkdown: note });
      expect(isPreserved(note, next, name)).toBe(true);
      note = next;
    }
    for (const s of ["Update 1", "Update 2", "Update 3", "Update 4", "That's wrong.", "insight 2", "insight 3", "insight 4"]) {
      expect(note).toContain(s);
    }
    expect(note.match(/^# Chain Rule$/gm)).toHaveLength(1);
  });

  it("keeps a previous note that has no generated header intact", () => {
    const foreign = "Some older note\n\nwith [[Links]].";
    const out = composeNote({ conceptName: name, sectionBody: "new", updateNumber: 2, date: "2026-10-01", previousMarkdown: foreign });
    expect(out.endsWith(foreign)).toBe(true);
  });

  it("demotes # and ## in the model's section, but leaves fenced code alone", () => {
    const body = "# Big title\n## Another\n### fine\n```python\n# a comment\nprint(1)\n```\ntext";
    const out = sanitizeSection(body);
    expect(out).toBe("### Big title\n### Another\n### fine\n```python\n# a comment\nprint(1)\n```\ntext");
  });

  it("the model can't fake structure: its headings never become top-level sections", () => {
    const out = composeNote({ conceptName: name, sectionBody: "## Update 99 · 2000-01-01\nfake", updateNumber: 1, date: "2026-09-20" });
    expect(out.match(/^## /gm)).toHaveLength(1);
  });

  it("rejects empty sections, bad dates, and bad update numbers", () => {
    expect(() => composeNote({ conceptName: name, sectionBody: "  \n ", updateNumber: 1, date: "2026-09-20" })).toThrow(/empty/);
    expect(() => composeNote({ conceptName: name, sectionBody: "x", updateNumber: 1, date: "20/09/2026" })).toThrow(/YYYY-MM-DD/);
    expect(() => composeNote({ conceptName: name, sectionBody: "x", updateNumber: 0, date: "2026-09-20" })).toThrow(/positive integer/);
  });
});

describe("extractPreviousBody / isPreserved", () => {
  it("strips only the generated header", () => {
    expect(extractPreviousBody("# Chain Rule\n\n## Update 1\n\nbody", name)).toBe("## Update 1\n\nbody");
    expect(extractPreviousBody("# Chain Rule", name)).toBe("");
    expect(extractPreviousBody("# Chain Rules\n\nbody", name)).toBe("# Chain Rules\n\nbody");
  });

  it("detects altered history", () => {
    const v1 = first();
    const v2 = composeNote({ conceptName: name, sectionBody: "new", updateNumber: 2, date: "2026-10-01", previousMarkdown: v1 });
    expect(isPreserved(v1, v2.replace("That's wrong.", "That's fine."), name)).toBe(false);
  });
});
