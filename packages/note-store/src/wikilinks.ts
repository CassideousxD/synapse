export interface WikiLink {
  /** Target as written, trimmed. "Chain Rule" */
  target: string;
  /** Normalized key used for matching. "chain rule" */
  key: string;
  /** Display text when written as [[Target|alias]] */
  alias?: string;
  /** Offset of the opening "[[" in the original markdown */
  index: number;
}

/** Case/whitespace/unicode-insensitive key for matching concept names. */
export function normalizeConceptName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Blank out code so [[links]] inside it are ignored.
 * Replaces every non-newline char with a space, so offsets stay valid.
 */
function maskCode(markdown: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return markdown
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, blank) // fenced blocks
    .replace(/`[^`\n]*`/g, blank); // inline code
}

// [[Target]] or [[Target|alias]]. No newlines, no nested brackets.
// Deliberately no [[Target#heading]] support: concept names like "C#" exist.
const WIKILINK_RE = /\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]*))?\]\]/g;

export function extractWikilinks(markdown: string): WikiLink[] {
  const masked = maskCode(markdown);
  const links: WikiLink[] = [];
  for (const m of masked.matchAll(WIKILINK_RE)) {
    const target = (m[1] ?? "").trim();
    if (target === "") continue;
    const alias = m[2]?.trim();
    links.push({
      target,
      key: normalizeConceptName(target),
      ...(alias ? { alias } : {}),
      index: m.index ?? 0,
    });
  }
  return links;
}
