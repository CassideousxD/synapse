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

export interface TeacherConceptMetric {
  id: string;
  name: string;
  classroomId: string;
  category: string;
  avgMastery: number | null;
  studentCount: number;
  strugglingCount: number;
  proficientCount: number;
  trendCounts: Record<string, number>;
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
  classrooms: TeacherClassroomMetric[];
  concepts: TeacherConceptMetric[];
  leaderboard: TeacherLeaderboardStudent[];
  recentActivity: TeacherActivityItem[];
}

export async function getTeacherAnalyticsDashboard(): Promise<TeacherAnalyticsDashboard> {
  return apiFetch<TeacherAnalyticsDashboard>("/analytics/teacher-dashboard");
}

