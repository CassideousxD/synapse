export interface ComposeInput {
  conceptName: string;
  /** Markdown the LLM wrote for THIS update only. */
  sectionBody: string;
  /** 1-based. Shown in the section heading. */
  updateNumber: number;
  /** YYYY-MM-DD. */
  date: string;
  /** The stored note before this run. Kept verbatim below the new section. */
  previousMarkdown?: string;
}

const SEPARATOR = "\n\n---\n\n";

/**
 * The model's section can't be allowed to add # or ## headings: those belong to the note's structure
 * (the concept title and one "Update N" section per cycle). Demote them, but leave fenced code alone
 * (a "# comment" line inside a Python block is not a heading).
 */
export function sanitizeSection(body: string): string {
  let inFence = false;
  return body
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      if (!inFence && /^#{1,2}\s/.test(line)) return `###${line.replace(/^#{1,2}/, "")}`;
      return line;
    })
    .join("\n")
    .trim();
}

/** The previous note minus the "# Concept Name" header code generated for it. Everything else is untouched. */
export function extractPreviousBody(markdown: string, conceptName: string): string {
  const header = `# ${conceptName}`;
  const trimmed = markdown.trim();
  if (trimmed === header) return "";
  if (trimmed.startsWith(`${header}\n`)) return trimmed.slice(header.length).trim();
  return trimmed;
}

export function composeNote(input: ComposeInput): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error(`date must be YYYY-MM-DD, got "${input.date}"`);
  if (!Number.isInteger(input.updateNumber) || input.updateNumber < 1) {
    throw new Error(`updateNumber must be a positive integer, got ${input.updateNumber}`);
  }
  const body = sanitizeSection(input.sectionBody);
  if (body === "") throw new Error("sectionBody must not be empty");

  const head = `# ${input.conceptName}\n\n## Update ${input.updateNumber} · ${input.date}\n\n${body}`;
  const previous = input.previousMarkdown ? extractPreviousBody(input.previousMarkdown, input.conceptName) : "";
  return previous === "" ? head : `${head}${SEPARATOR}${previous}`;
}

/** True if the previous note's text still appears, unaltered, inside the new one. */
export function isPreserved(previousMarkdown: string, nextMarkdown: string, conceptName: string): boolean {
  const body = extractPreviousBody(previousMarkdown, conceptName);
  return body === "" || nextMarkdown.includes(body);
}
