/**
 * Demo state (temporary). Holds the local demo session and mutable demo data.
 * When the REST backend is connected, swap the services layer to call the API
 * instead of reading/writing this store.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  classrooms as seedClassrooms,
  notes as seedNotes,
  tests as seedTests,
  submissions as seedSubs,
  DEMO_STUDENT_ID,
  type Classroom,
  type Note,
  type Test,
  type Submission,
} from "@/demo/data";
import { concepts } from "@/demo/concepts";

export type DemoRole = "teacher" | "student";
export type Theme = "dark" | "light";

export interface DetailedMasteryChange {
  conceptId: string;
  conceptName: string;
  previousMastery: number;
  newMastery: number;
  change: number;
  correctCount: number;
  totalCount: number;
  performance: string;
}

export interface RevisionConcept {
  conceptId: string;
  conceptName: string;
  currentMastery: number;
  reason: string;
  recentPerformance: string;
}

export interface TestResult {
  testId: string;
  score: number;
  correct: string[];
  incorrect: string[];
  masteryChanges: Record<string, number>;
  detailedMasteryChanges?: DetailedMasteryChange[];
  revisionConcepts?: RevisionConcept[];
  date: string;
  isLate?: boolean;
  status?: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: DemoRole;
}

interface DemoState {
  role: DemoRole | null;
  user: AuthUser | null;
  theme: Theme;
  classrooms: Classroom[];
  notes: Note[];
  tests: Test[];
  submissions: Submission[];
  enrolled: string[];
  mastery: Record<string, number | null>;
  results: Record<string, TestResult>;
  setRole: (r: DemoRole | null) => void;
  setUser: (u: AuthUser | null) => void;
  toggleTheme: () => void;
  joinClass: (code: string) => { ok: true; classroom: Classroom } | { ok: false; reason: string };
  leaveClass: (id: string) => void;
  submitTest: (testId: string, answers: Record<string, string>) => TestResult;
  saveTest: (t: Test) => void;
  addNote: (n: Note) => void;
  deleteNote: (id: string) => void;
  toggleNote: (id: string) => void;
  createClassroom: (name: string, subject: string) => Classroom;
  reset: () => void;
}

const initial = () => ({
  classrooms: seedClassrooms,
  notes: seedNotes,
  tests: seedTests,
  submissions: seedSubs,
  enrolled: ["dsa", "discrete"],
  mastery: Object.fromEntries(concepts.map((c) => [c.id, c.mastery])),
  results: {} as Record<string, TestResult>,
});

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9²|+]/g, "");

export const useDemo = create<DemoState>()(
  persist(
    (set, get) => ({
      role: null,
      user: null,
      theme: "dark",
      ...initial(),
      setRole: (role) => set({ role }),
      setUser: (user) => {
        if (user) {
          set({
            user,
            role: user.role,
            classrooms: [],
            notes: [],
            tests: [],
            submissions: [],
            enrolled: [],
            mastery: {},
            results: {},
          });
        } else {
          set({
            user: null,
            role: null,
            ...initial(),
          });
        }
      },
      toggleTheme: () => set({ theme: get().theme === "dark" ? "light" : "dark" }),
      joinClass: (code) => {
        const c = get().classrooms.find((x) => x.joinCode === code.trim().toUpperCase());
        if (!c) return { ok: false, reason: "That code doesn't match any classroom. Check with your teacher." };
        if (get().enrolled.includes(c.id)) return { ok: false, reason: `You're already enrolled in ${c.name}.` };
        set({
          enrolled: [...get().enrolled, c.id],
          classrooms: get().classrooms.map((x) =>
            x.id === c.id && !x.studentIds.includes(DEMO_STUDENT_ID) ? { ...x, studentIds: [...x.studentIds, DEMO_STUDENT_ID] } : x,
          ),
        });
        return { ok: true, classroom: c };
      },
      leaveClass: (id) => {
        set({
          enrolled: get().enrolled.filter((cId) => cId !== id),
          classrooms: get().classrooms.map((x) =>
            x.id === id ? { ...x, studentIds: x.studentIds.filter((s) => s !== DEMO_STUDENT_ID) } : x,
          ),
        });
      },
      submitTest: (testId, answers) => {
        const t = get().tests.find((x) => x.id === testId)!;
        const correct: string[] = [];
        const incorrect: string[] = [];
        const delta: Record<string, number> = {};
        const qStats: Record<string, { correct: number; total: number }> = {};
        for (const q of t.questions) {
          const ok = norm(answers[q.id] ?? "") === norm(q.answer);
          (ok ? correct : incorrect).push(q.id);
          delta[q.conceptId] = (delta[q.conceptId] ?? 0) + (ok ? 4 : -3);
          const st = qStats[q.conceptId] || { correct: 0, total: 0 };
          st.total += 1;
          if (ok) st.correct += 1;
          qStats[q.conceptId] = st;
        }
        const mastery = { ...get().mastery };
        const detailedMasteryChanges: DetailedMasteryChange[] = [];
        const revisionConcepts: RevisionConcept[] = [];

        for (const [k, d] of Object.entries(delta)) {
          const prev = mastery[k] ?? 50;
          const next = Math.max(0, Math.min(100, prev + d));
          mastery[k] = next;
          const cName = conceptById[k]?.name || k.replace(/^c-/, "").replace(/-/g, " ");
          const st = qStats[k] || { correct: d > 0 ? 1 : 0, total: 1 };
          const pct = Math.round((st.correct / st.total) * 100);

          detailedMasteryChanges.push({
            conceptId: k,
            conceptName: cName,
            previousMastery: prev,
            newMastery: next,
            change: next - prev,
            correctCount: st.correct,
            totalCount: st.total,
            performance: `${st.correct}/${st.total} correct (${pct}%)`,
          });

          if (next < 55 || st.correct < st.total || d < 0) {
            revisionConcepts.push({
              conceptId: k,
              conceptName: cName,
              currentMastery: next,
              reason: st.correct === 0 ? "Missed questions on recent assessment" : `Mastery (${next}%) below proficiency threshold`,
              recentPerformance: `${st.correct}/${st.total} (${pct}%)`,
            });
          }
        }
        const score = Math.round((correct.length / t.questions.length) * 100);
        const result: TestResult = {
          testId,
          score,
          correct,
          incorrect,
          masteryChanges: delta,
          detailedMasteryChanges,
          revisionConcepts,
          date: "Today",
        };
        set({
          mastery,
          results: { ...get().results, [testId]: result },
          submissions: [...get().submissions.filter((s) => !(s.testId === testId && s.studentId === DEMO_STUDENT_ID)), { testId, studentId: DEMO_STUDENT_ID, score, date: "Today" }],
        });
        return result;
      },
      saveTest: (t) => set({ tests: [t, ...get().tests.filter((x) => x.id !== t.id)] }),
      addNote: (n) => set({ notes: [n, ...get().notes] }),
      deleteNote: (id) => set({ notes: get().notes.filter((x) => x.id !== id) }),
      toggleNote: (id) => set({ notes: get().notes.map((n) => (n.id === id ? { ...n, published: !n.published } : n)) }),
      createClassroom: (name, subject) => {
        const code = Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
        const c: Classroom = {
          id: `c-${Date.now()}`, name, subject, joinCode: code, teacherId: "t-raman", studentIds: [], conceptIds: [],
          description: "A newly created classroom.", activity: [{ id: "new", who: "You", what: "created this classroom", when: "Just now" }],
        };
        set({ classrooms: [...get().classrooms, c] });
        return c;
      },
      reset: () => set({ ...initial() }),
    }),
    {
      name: "synapse-demo",
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (state?.user) {
          // If a real user is signed in, ensure demo seeds are purged so new accounts start completely fresh
          if (state.classrooms?.some((c) => c.teacherId === "t-raman")) {
            state.classrooms = [];
          }
          if (state.notes?.some((n) => n.id === "graphs")) {
            state.notes = [];
          }
          if (state.tests?.some((t) => t.id === "trees-traversals")) {
            state.tests = [];
          }
          if (state.submissions?.some((s) => s.studentId === DEMO_STUDENT_ID)) {
            state.submissions = [];
          }
          if (state.enrolled?.includes("dsa")) {
            state.enrolled = [];
          }
          if (Object.keys(state.mastery || {}).length > 10) {
            state.mastery = {};
          }
        }
      },
    },
  ),
);

