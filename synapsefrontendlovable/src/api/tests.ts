import { apiFetch } from "./client";
import type { Question, Submission, Test } from "@/demo/data";
import type { TestResult } from "@/stores/demo-store";

export interface CreateTestPayload {
  title: string;
  classroomId: string;
  durationMin?: number;
  due?: string;
  dueAt?: string;
  status: "published" | "draft";
  conceptIds?: string[];
  questions: Question[];
}

export async function getTests(classroomId?: string): Promise<Test[]> {
  const query = classroomId ? `?classroomId=${encodeURIComponent(classroomId)}` : "";
  return apiFetch<Test[]>(`/tests${query}`);
}

export async function getTest(id: string): Promise<Test> {
  return apiFetch<Test>(`/tests/${id}`);
}

export async function createTest(payload: CreateTestPayload): Promise<Test> {
  return apiFetch<Test>("/tests", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateTestStatus(
  id: string,
  status: "published" | "draft",
): Promise<Test> {
  return apiFetch<Test>(`/tests/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function submitTest(
  testId: string,
  answers: Record<string, string>,
): Promise<TestResult> {
  return apiFetch<TestResult>(`/tests/${testId}/submit`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

export async function getSubmissions(): Promise<Submission[]> {
  return apiFetch<Submission[]>("/submissions");
}

export interface GenerateQuestionsPayload {
  classroomId: string;
  conceptIds?: string[];
  count?: number;
}

export async function generateQuestions(payload: GenerateQuestionsPayload): Promise<Question[]> {
  return apiFetch<Question[]>("/tests/generate-questions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

