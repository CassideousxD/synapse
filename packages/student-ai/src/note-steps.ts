import type { Steps } from "@synapse/agent-runtime";
import type { LlmClient } from "@synapse/llm-client";
import { checkSection } from "./checks";
import { sanitizeSection } from "./compose";
import { callJson, type Tier } from "./json";
import type { NoteRunInput } from "./note-types";
import { buildAskMessages, buildReviewMessages, buildReviseMessages, buildSectionMessages } from "./note-prompts";
import { reviewDraftValidator, toReviewOutcome } from "./review";
import { clip, cleanModelText, extractTagged, looksLikeReasoning, stripLeadingUpdateHeading } from "./text";

export type NoteStepName = "draft" | "revise" | "review" | "ask";

export interface NoteStepsDeps {
  llm: Pick<LlmClient, "chat">;
  /** Default "main" for all four. */
  tiers?: Partial<Record<NoteStepName, Tier>>;
  /** Repairs allowed for the reviewer's JSON. Default 1. */
  maxRepairs?: number;
}

const WRITING_TEMPERATURE = 0.3;
// Explicit caps: a model that starts rambling costs a bounded amount of time. A normal section is well under 600 tokens.
const WRITING_MAX_TOKENS = 1800;
const ASK_MAX_TOKENS = 400;
const REVIEW_MAX_TOKENS = 1200;

const REASONING_REMINDER =
  "Your reply contained your reasoning about the task instead of the note section. " +
  "Reply with ONLY the final section text (markdown), exactly as the student should read it. Do not explain what you are doing.";

/**
 * The four agent-runtime steps for one student, one concept. D = this update's section (markdown),
 * Q = the question shown to the student, A = the student's answer.
 */
export function createNoteSteps(deps: NoteStepsDeps): Steps<NoteRunInput, string, string, string> {
  const tierFor = (step: NoteStepName): Tier => deps.tiers?.[step] ?? "main";

  /**
   * A plain-text step. The model is asked to put its answer inside <tag>...</tag>: a reply cut off before the closing tag
   * is an error (retryable), and any reasoning before the tags is ignored. A reply with no tags is accepted, but if it reads
   * like the model's reasoning it is re-asked once and then fails. A failed step is retryable and leaves the last good draft
   * in place, whereas junk returned as a draft would sit in the run's state, be fed back to the model, and could be saved.
   */
  async function text(
    step: NoteStepName,
    messages: Parameters<typeof callJson>[0]["messages"],
    tag: string,
    maxTokens: number,
  ): Promise<string> {
    let convo = messages;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await deps.llm.chat({ tier: tierFor(step), messages: convo, temperature: WRITING_TEMPERATURE, maxTokens });
      const answer = extractTagged(res.content, tag);
      if (answer === null) throw new Error(`The model's reply for the "${step}" step was cut off before it finished`);
      const out = stripLeadingUpdateHeading(cleanModelText(answer));
      if (out === "") throw new Error(`The model returned an empty reply for the "${step}" step`);
      // A question for the student is not section text, so the reasoning heuristics do not apply to it.
      if (step === "ask" || !looksLikeReasoning(out)) return out;
      convo = [
        ...messages,
        { role: "assistant", content: clip(res.content, 1500) },
        { role: "user", content: REASONING_REMINDER },
      ];
    }
    throw new Error(`The model kept writing its reasoning instead of the note for the "${step}" step`);
  }

  return {
    draft: ({ input }) => text("draft", buildSectionMessages(input), "note_section", WRITING_MAX_TOKENS),

    revise: ({ input, draft, objections, clarifications }) =>
      text("revise", buildReviseMessages(input, draft, objections, clarifications), "note_section", WRITING_MAX_TOKENS),

    async review({ input, draft, clarifications }) {
      const section = sanitizeSection(draft);
      // Cheap, certain checks first: no point paying for a reviewer to say "you linked a concept that doesn't exist".
      const problems = checkSection(section, input.linkable);
      if (problems.length > 0) return { accepted: false, objections: problems };

      const verdict = await callJson({
        llm: deps.llm,
        tier: tierFor("review"),
        messages: buildReviewMessages(input, section, clarifications),
        validator: reviewDraftValidator,
        maxTokens: REVIEW_MAX_TOKENS,
        ...(deps.maxRepairs !== undefined ? { maxRepairs: deps.maxRepairs } : {}),
      });
      return toReviewOutcome(verdict);
    },

    async ask({ input, draft, objections, clarifications, stopReason, suggestedQuestion }) {
      // The reviewer already wrote a question: don't pay for a second opinion on wording.
      if (suggestedQuestion !== null && suggestedQuestion.trim() !== "") return suggestedQuestion.trim();
      return text("ask", buildAskMessages(input, draft, objections, clarifications, stopReason), "question", ASK_MAX_TOKENS);
    },
  };
}
