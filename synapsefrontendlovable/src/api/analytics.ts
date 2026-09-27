import { apiFetch } from "./client";

export interface ConceptSummary {
  conceptId: string;
  studentCount: number;
  avgMastery: number;
  trendCounts: Record<string, number>;
}

export interface StudentMasteryPayload {
  studentId: string;
  conceptId: string;
  mastery: number;
  trend: string;
  computedAt: string;
}

export async function getAnalyticsSummary(): Promise<ConceptSummary[]> {
  return apiFetch<ConceptSummary[]>("/analytics/summary");
}

export async function getAnalyticsPayloads(): Promise<StudentMasteryPayload[]> {
  return apiFetch<StudentMasteryPayload[]>("/analytics/payloads");
}

export async function getStudentConceptPayload(
  studentId: string,
  conceptId: string,
): Promise<StudentMasteryPayload> {
  return apiFetch<StudentMasteryPayload>(`/analytics/payload/${studentId}/${conceptId}`);
}

export interface ConceptMasteryRecord {
  mastery: number;
  trend: string;
  computedAt: string;
}

export async function getStudentMastery(): Promise<Record<string, ConceptMasteryRecord>> {
  return apiFetch<Record<string, ConceptMasteryRecord>>("/analytics/mastery");
}

export interface TeacherDashboardOverview {
  classroomCount: number;
  studentCount: number;
  activeStudentCount: number;
  publishedTestCount: number;
  totalSubmissionCount: number;
  expectedSubmissionCount?: number;
  completionRate?: number | null;
  averageScore: number | null;
  averageMastery: number | null;
  weakConceptCount: number;
}

export interface TeacherClassroomMetric {
  id: string;
  name: string;
  subject: string;
  joinCode: string;
  studentCount: number;
  averageMastery: number | null;
  testCount: number;
  submissionCount: number;
  averageScore: number | null;
}

export interface TeacherConceptStudent {
  id: string;
  name: string;
  email: string;
  mastery: number;
  trend: string;
  status: string;
}

export interface TeacherConceptMetric {
  id: string;
  name: string;
  classroomId: string;
  classroomName?: string;
  category: string;
  avgMastery: number | null;
  studentCount: number;
  strugglingCount: number;
  proficientCount: number;
  status?: string;
  improvingCount?: number;
  stillWeakCount?: number;
  newGapCount?: number;
  trendCounts: Record<string, number>;
  students?: TeacherConceptStudent[];
}

export interface TeacherStudentWeakConcept {
  id: string;
  name: string;
  mastery: number;
  trend: string;
}

export interface TeacherStudentRecentSubmission {
  testId: string;
  testTitle: string;
  score: number;
  isLate: boolean;
  submittedAt: string;
}

export interface TeacherStudentSupportMetric {
  id: string;
  name: string;
  email: string;
  classroomNames?: string[];
  classroomName: string;
  avgScore: number | null;
  testsCompleted: number;
  avgMastery: number | null;
  weakConceptCount: number;
  weakConcepts?: TeacherStudentWeakConcept[];
  recentSubmissions?: TeacherStudentRecentSubmission[];
}

export interface TeacherLeaderboardStudent {
  id: string;
  name: string;
  email: string;
  avgScore: number | null;
  testsCompleted: number;
  avgMastery: number | null;
  weakConceptCount: number;
}

export interface TeacherTestQuestionMistake {
  answer: string;
  count: number;
}

export interface TeacherTestQuestionMetric {
  id: string;
  index: number;
  prompt: string;
  type: string;
  options?: string[];
  conceptId: string;
  conceptName: string;
  expectedAnswer: string;
  answeredCount: number;
  correctCount: number;
  correctPercentage: number | null;
  commonMistakes: TeacherTestQuestionMistake[];
}

export interface TeacherTestMetric {
  id: string;
  title: string;
  classroomId: string;
  classroomName: string;
  status: string;
  durationMin: number;
  due: string;
  dueAt: string | null;
  createdAt: string | null;
  submissionCount: number;
  enrolledCount: number;
  completionRate: number;
  averageScore: number | null;
  lateCount: number;
  scoreDistribution: Record<string, number>;
  questions: TeacherTestQuestionMetric[];
}

export interface TeacherActivityItem {
  id: string;
  type: "submission" | "enrollment" | "note" | "test";
  who: string;
  what: string;
  cls: string;
  timestamp: string;
}

export interface TeacherAnalyticsDashboard {
  overview: TeacherDashboardOverview;
  selectedClassroomId?: string | null;
  allClassrooms?: Array<{ id: string; name: string; subject: string }>;
  classrooms: TeacherClassroomMetric[];
  concepts: TeacherConceptMetric[];
  students?: TeacherStudentSupportMetric[];
  leaderboard: TeacherLeaderboardStudent[];
  tests?: TeacherTestMetric[];
  recentActivity: TeacherActivityItem[];
}

export async function getTeacherAnalyticsDashboard(classroomId?: string): Promise<TeacherAnalyticsDashboard> {
  const url = classroomId
    ? `/analytics/teacher-dashboard?classroom_id=${encodeURIComponent(classroomId)}`
    : "/analytics/teacher-dashboard";
  return apiFetch<TeacherAnalyticsDashboard>(url);
}

