// Same defensive stripping as json.ts: some reasoning models wrap thinking in <think> tags.
const THINK_RE = /<think>[\s\S]*?<\/think>/gi;
// Only unwrap a fence that is tagged markdown/md or untagged (a section that is purely a ```python block stays as is).
const WRAPPED_FENCE_RE = /^```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n```$/i;

/** Tidy a plain-text model reply: drop <think> blocks and unwrap a single wrapping code fence. */
export function cleanModelText(raw: string): string {
  const text = raw.replace(THINK_RE, "").trim();
  const wrapped = WRAPPED_FENCE_RE.exec(text);
  return wrapped?.[1] !== undefined ? wrapped[1].trim() : text;
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[...truncated...]`;
}

/** Student-written text goes into prompts as data. Strip our own delimiter so it can't be closed early. */
export function wrapStudentText(text: string): string {
  const clean = text.replace(/<\/?student_answer>/gi, "").trim();
  return `<student_answer>\n${clean}\n</student_answer>`;
}

/**
 * Invisible (in rendered markdown) marker recording which test's run wrote a section, so the pipeline can tell
 * "this update is already in the note". Only the test id: it must be unique within ONE student's note for ONE concept,
 * and it must not carry the student id (notes are sent to the model as context).
 */
export const runMarker = (cycleId: string): string =>
  `<!-- synapse-run:${encodeURIComponent(cycleId).replace(/-/g, "%2D")} -->`;

const RUN_MARKER_RE = /[ \t]*<!-- synapse-run:[^>]*-->/g;

/** Remove run markers (and the spaces before them), e.g. before showing an earlier note to the model. Newlines are left alone. */
export const stripRunMarkers = (markdown: string): string => markdown.replace(RUN_MARKER_RE, "");

/**
 * Reasoning models sometimes think out loud in the reply and give the real answer at the end. We ask for the
 * answer inside <tag>...</tag> and keep only the LAST complete block. Returns null if the last block was opened
 * but never closed (the reply was cut off, so the answer is unfinished). A reply with no tags at all is used whole.
 */
export function extractTagged(raw: string, tag: string): string | null {
  const text = raw.replace(THINK_RE, "");
  const lower = text.toLowerCase();
  const open = `<${tag.toLowerCase()}>`;
  const close = `</${tag.toLowerCase()}>`;
  const lastOpen = lower.lastIndexOf(open);
  const lastClose = lower.lastIndexOf(close);
  if (lastOpen === -1 && lastClose === -1) return text;
  if (lastOpen > lastClose) return null;
  const start = lower.lastIndexOf(open, lastClose);
  return start === -1 ? text.slice(0, lastClose).trim() : text.slice(start + open.length, lastClose).trim();
}

// Markers of a model thinking out loud about the TASK instead of writing the note. Each one is meta talk that a note
// written to the student ("you") has no reason to contain, so a single hit is not enough but two are.
const REASONING_MARKERS: readonly RegExp[] = [
  /\bthe objections?\b/i,
  /\b(the|my|these) instructions?\b/i,
  /\bthe student('s)? (answer|said|says|actually)\b/i,
  /\bwait[:,!]/i,
  /\b(we|i) (must|need to|should) (fix|revise|address|follow|use|treat|correct|craft|adjust|reconcile|interpret)\b/i,
  /\bthe section (claims|says|states|should|must|needs)\b/i,
  /\blet'?s (craft|draft|parse|reconcile|rewrite|produce)\b/i,
];
const REASONING_START = /^\s*(we need to|i need to|let me|okay[,.]|hmm|the user|first,? (i|we) )/i;
const PROMPT_LEAKS = /<\/?(student_answer|current_section|previous_notes|section_to_review)>|^TASK:/im;

/**
 * Did the model write its reasoning (or echo our prompt) instead of the section? Observed live: an 859-word
 * "We need to revise the section... Wait: The student answer says..." monologue with no <think> tags.
 * Deliberately high-precision: a false alarm costs one extra model call, a miss puts junk in a student's note.
 */
export function looksLikeReasoning(text: string): boolean {
  if (PROMPT_LEAKS.test(text)) return true;
  if (REASONING_START.test(text)) return true;
  return REASONING_MARKERS.filter((re) => re.test(text)).length >= 2;
}

/**
 * The app writes each section's "## Update N · date" heading itself. Models imitate the older notes they are shown
 * and add their own (with invented dates), so drop such a heading if it opens the section. Needs the number, so a
 * genuine heading like "Update rule" survives.
 */
export function stripLeadingUpdateHeading(text: string): string {
  let out = text;
  for (;;) {
    const next = out.replace(/^\s*#{1,6}[ \t]*Update[ \t]+\d+[^\n]*\n+/i, "");
    if (next === out) return out.trim();
    out = next;
  }
}
