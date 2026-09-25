/**
 * A question as the student saw it. Attempt only carries ids, and the model can't diagnose
 * "why did they pick B?" without the wording. Local for now; it becomes a contract in Phase 8,
 * when the teacher API generates tests. Attempt.selectedOption / correctOption are matched
 * against options[].id.
 */
export interface QuestionContext {
  questionId: string;
  stem: string;
  options: { id: string; text: string }[];
}
