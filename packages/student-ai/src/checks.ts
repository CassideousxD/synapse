import { extractWikilinks, normalizeConceptName } from "@synapse/note-store";
import { sanitizeSection } from "./compose";
import type { LinkableConcept } from "./note-types";

export const MIN_SECTION_CHARS = 60;
export const MAX_SECTION_CHARS = 3000;
const MAX_LISTED_NAMES = 12;

/**
 * Deterministic checks run BEFORE the LLM reviewer: cheap, never wrong about a link, and they save a call.
 * Returns objections in the same string form the runtime uses. [] means the section passes.
 */
export function checkSection(section: string, linkable: readonly LinkableConcept[]): string[] {
  const text = sanitizeSection(section);
  const problems: string[] = [];

  if (text.length < MIN_SECTION_CHARS) {
    problems.push(
      `[format] The section is too short (${text.length} characters). Explain the idea properly, at least ${MIN_SECTION_CHARS} characters.`,
    );
  }
  if (text.length > MAX_SECTION_CHARS) {
    problems.push(
      `[format] The section is too long (${text.length} characters). Keep it under ${MAX_SECTION_CHARS} and cut what is not essential.`,
    );
  }

  const known = new Set(linkable.map((c) => normalizeConceptName(c.name)));
  const unknown = [...new Set(extractWikilinks(text).filter((l) => !known.has(l.key)).map((l) => l.target))];
  if (unknown.length > 0) {
    const bad = unknown.map((u) => `[[${u}]]`).join(", ");
    const allowed = linkable.slice(0, MAX_LISTED_NAMES).map((c) => `[[${c.name}]]`).join(", ");
    problems.push(
      `[links] These links point to concepts that are not in the curriculum: ${bad}. ` +
        (linkable.length > 0 ? `Only link to: ${allowed}. Remove the others.` : "Use no [[links]] at all."),
    );
  }
  return problems;
}
