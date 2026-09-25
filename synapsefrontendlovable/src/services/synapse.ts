/**
 * Services layer — the UI only talks to these hooks.
 * Connects to the backend REST API with smooth fallback to the demo store.
 */
import { useMemo } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useDemo } from "@/stores/demo-store";
import { getToken } from "@/api/client";
import {
  getAnalyticsSummary as apiGetAnalyticsSummary,
  getStudentMastery as apiGetStudentMastery,
  getTeacherAnalyticsDashboard as apiGetTeacherAnalyticsDashboard,
  type TeacherAnalyticsDashboard,
} from "@/api/analytics";
import {
  getClassroomStudents as apiGetClassroomStudents,
  getClassroom as apiGetClassroom,
  getClassrooms as apiGetClassrooms,
  createClassroom as apiCreateClassroom,
  joinClassroom as apiJoinClassroom,
  leaveClassroom as apiLeaveClassroom,
  getClassroomConcepts as apiGetClassroomConcepts,
  getStudentConcepts as apiGetStudentConcepts,
  type ClassroomConcept,
} from "@/api/classrooms";
import {
  getNotes as apiGetNotes,
  getNote as apiGetNote,
  createNote as apiCreateNote,
  updateNote as apiUpdateNote,
  deleteNote as apiDeleteNote,
  retryNoteExtraction as apiRetryNote,
  normalizeNote,
} from "@/api/notes";
import {
  getTests as apiGetTests,
  createTest as apiCreateTest,
  submitTest as apiSubmitTest,
  getSubmissions as apiGetSubmissions,
  generateQuestions as apiGenerateQuestions,
} from "@/api/tests";
import {
  getNotifications as apiGetNotifications,
  getUnreadNotificationsCount as apiGetUnreadNotificationsCount,
  markNotificationAsRead as apiMarkNotificationAsRead,
  markAllNotificationsAsRead as apiMarkAllNotificationsAsRead,
} from "@/api/notifications";
import {
  students,
  teacher,
  DEMO_STUDENT_ID,
  arjunHistory,
  tailoredReasons,
  type Classroom,
  type Note,
  type Test,
  type Submission,
  type NotificationItem,
} from "@/demo/data";
import { concepts, conceptById, masteryState } from "@/demo/concepts";

export const queryKeys = {
  classrooms: (userId?: string) => ["classrooms", userId] as const,
  classroom: (id: string) => ["classroom", id] as const,
  classroomStudents: (classroomId?: string) => ["classroom-students", classroomId] as const,
  notes: (classroomId?: string) => ["notes", classroomId] as const,
  note: (id: string) => ["note", id] as const,
  tests: (classroomId?: string) => ["tests", classroomId] as const,
  submissions: () => ["submissions"] as const,
  analyticsSummary: () => ["analytics-summary"] as const,
  studentMastery: () => ["student-mastery"] as const,
  studentConcepts: (userId?: string) => ["student-concepts", userId] as const,
  classroomConcepts: (classroomId?: string) => ["classroom-concepts", classroomId] as const,
  notifications: () => ["notifications"] as const,
  unreadNotifications: () => ["notifications", "unread"] as const,
  teacherDashboard: () => ["teacher-analytics-dashboard"] as const,
};

export const invalidateQueries = {
  classroomCreated: async (queryClient: QueryClient) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["classrooms"] }),
      queryClient.invalidateQueries({ queryKey: ["classroom"] }),
      queryClient.invalidateQueries({ queryKey: ["classroom-concepts"] }),
      queryClient.invalidateQueries({ queryKey: ["student-concepts"] }),
    ]);
  },
  classroomJoined: async (queryClient: QueryClient, classroomId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["classrooms"] }),
      queryClient.invalidateQueries({ queryKey: ["classroom"] }),
      queryClient.invalidateQueries({ queryKey: ["classroom-students"] }),
      queryClient.invalidateQueries({ queryKey: ["notes"] }),
      queryClient.invalidateQueries({ queryKey: ["tests"] }),
      queryClient.invalidateQueries({ queryKey: ["student-mastery"] }),
      queryClient.invalidateQueries({ queryKey: ["classroom-concepts"] }),
      queryClient.invalidateQueries({ queryKey: ["student-concepts"] }),
      queryClient.invalidateQueries({ queryKey: ["teacher-analytics-dashboard"] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.unreadNotifications() }),
    ]);
  },
  classroomLeft: async (queryClient: QueryClient, classroomId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["classrooms"] }),
      queryClient.invalidateQueries({ queryKey: ["classroom"] }),
      queryClient.invalidateQueries({ queryKey: ["classroom-students"] }),
      queryClient.invalidateQueries({ queryKey: ["notes"] }),
      queryClient.invalidateQueries({ queryKey: ["tests"] }),
      queryClient.invalidateQueries({ queryKey: ["submissions"] }),
      queryClient.invalidateQueries({ queryKey: ["student-mastery"] }),
      queryClient.invalidateQueries({ queryKey: ["analytics-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["classroom-concepts"] }),
      queryClient.invalidateQueries({ queryKey: ["student-concepts"] }),
      queryClient.invalidateQueries({ queryKey: ["teacher-analytics-dashboard"] }),
    ]);
    if (classroomId) {
      queryClient.removeQueries({ queryKey: ["classroom-students", classroomId] });
      queryClient.removeQueries({ queryKey: ["classroom", classroomId] });
      queryClient.removeQueries({ queryKey: ["classroom-concepts", classroomId] });
    }
  },
  noteSaved: async (queryClient: QueryClient) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["notes"] }),
      queryClient.invalidateQueries({ queryKey: ["classrooms"] }),
      queryClient.invalidateQueries({ queryKey: ["classroom-concepts"] }),
      queryClient.invalidateQueries({ queryKey: ["student-concepts"] }),
      queryClient.invalidateQueries({ queryKey: ["student-mastery"] }),
      queryClient.invalidateQueries({ queryKey: ["teacher-analytics-dashboard"] }),
    ]);
  },
  noteDeleted: async (queryClient: QueryClient, noteId?: string, classroomId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["notes"] }),
      queryClient.invalidateQueries({ queryKey: ["classrooms"] }),
      queryClient.invalidateQueries({ queryKey: ["classroom-concepts"] }),
      queryClient.invalidateQueries({ queryKey: ["student-concepts"] }),
      queryClient.invalidateQueries({ queryKey: ["student-mastery"] }),
      queryClient.invalidateQueries({ queryKey: ["teacher-analytics-dashboard"] }),
    ]);
    if (noteId) {
      queryClient.removeQueries({ queryKey: ["note", noteId] });
    }
    if (classroomId) {
      queryClient.removeQueries({ queryKey: ["classroom-concepts", classroomId] });
    }
  },
  notePublishedToggled: async (queryClient: QueryClient) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["notes"] }),
      queryClient.invalidateQueries({ queryKey: ["classrooms"] }),
      queryClient.invalidateQueries({ queryKey: ["classroom-concepts"] }),
      queryClient.invalidateQueries({ queryKey: ["student-concepts"] }),
      queryClient.invalidateQueries({ queryKey: ["student-mastery"] }),
      queryClient.invalidateQueries({ queryKey: ["teacher-analytics-dashboard"] }),
    ]);
  },
  testCreated: async (queryClient: QueryClient) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tests"] }),
      queryClient.invalidateQueries({ queryKey: ["classrooms"] }),
      queryClient.invalidateQueries({ queryKey: ["classroom-concepts"] }),
      queryClient.invalidateQueries({ queryKey: ["teacher-analytics-dashboard"] }),
    ]);
  },
  testSubmitted: async (queryClient: QueryClient) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["submissions"] }),
      queryClient.invalidateQueries({ queryKey: ["student-mastery"] }),
      queryClient.invalidateQueries({ queryKey: ["tests"] }),
      queryClient.invalidateQueries({ queryKey: ["classrooms"] }),
      queryClient.invalidateQueries({ queryKey: ["analytics-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["student-concepts"] }),
      queryClient.invalidateQueries({ queryKey: ["teacher-analytics-dashboard"] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.unreadNotifications() }),
    ]);
  },
  notificationChanged: async (queryClient: QueryClient) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.unreadNotifications() }),
    ]);
  },
};

export const useTeacher = () => {
  const user = useDemo((s) => s.user);
  if (user && user.role === "teacher") {
    return { id: user.id, name: user.name, department: "Computer Science & Mathematics" };
  }
  return teacher;
};

export const useCurrentStudent = () => {
  const user = useDemo((s) => s.user);
  if (user && user.role === "student") {
    return {
      id: user.id,
      name: user.name,
      testsCompleted: 0,
      avgScore: 0,
      mastery: 0,
      strongest: "—",
      weakest: "—",
      trend: [],
    };
  }
  return (
    students.find((s) => s.id === DEMO_STUDENT_ID) || {
      id: "demo-student",
      name: "Student",
      testsCompleted: 0,
      avgScore: 0,
      mastery: 0,
      strongest: "—",
      weakest: "—",
      trend: [],
    }
  );
};

export const getStudent = (id: string) => students.find((s) => s.id === id);

export function useClassrooms(): Classroom[] {
  const demoClasses = useDemo((s) => s.classrooms);
  const user = useDemo((s) => s.user);
  const token = getToken();

  const { data: serverClasses } = useQuery({
    queryKey: queryKeys.classrooms(user?.id),
    queryFn: apiGetClassrooms,
    enabled: !!token,
  });

  if (user || token) {
    return serverClasses ?? [];
  }
  return demoClasses;
}

export function useClassroom(id: string) {
  const token = getToken();
  const user = useDemo((s) => s.user);

  const { data: directClass, isLoading } = useQuery({
    queryKey: queryKeys.classroom(id),
    queryFn: () => apiGetClassroom(id),
    enabled: !!token && !!id,
  });

  const classes = useClassrooms();
  const fromList = classes.find((c) => c.id === id);

  const classroom = user || token ? (directClass ?? fromList) : fromList;
  const loading = !!token && isLoading && !fromList;

  return {
    classroom,
    isLoading: loading,
  };
}

export function useClassroomStudents(classroomId: string) {
  const token = getToken();
  return useQuery({
    queryKey: queryKeys.classroomStudents(classroomId),
    queryFn: () => apiGetClassroomStudents(classroomId),
    enabled: !!token && !!classroomId,
  });
}

export { apiRetryNote };

export function useNotes(classroomId?: string): Note[] {
  const demoNotes = useDemo((s) => s.notes);
  const user = useDemo((s) => s.user);
  const token = getToken();

  const { data: serverNotes } = useQuery({
    queryKey: queryKeys.notes(classroomId),
    queryFn: () => apiGetNotes(classroomId),
    enabled: !!token,
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasProcessing = Array.isArray(data) && data.some((n) => n.status === "PROCESSING");
      return hasProcessing ? 2000 : 60000;
    },
  });

  const notes = useMemo(() => {
    const rawList = user || token ? (serverNotes ?? []) : (demoNotes ?? []);
    const normalized = Array.isArray(rawList) ? rawList.map(normalizeNote) : [];
    return classroomId ? normalized.filter((n) => n.classroomId === classroomId) : normalized;
  }, [user, token, serverNotes, demoNotes, classroomId]);

  return notes;
}

export function useNote(id: string) {
  const token = getToken();
  const user = useDemo((s) => s.user);
  const notes = useNotes();
  const fromList = notes.find((n) => n.id === id);

  const { data: directNote, isLoading } = useQuery({
    queryKey: queryKeys.note(id),
    queryFn: () => apiGetNote(id),
    enabled: !!token && !!id,
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === "PROCESSING" ? 2000 : false;
    },
  });

  const rawNote = user || token ? (directNote ?? fromList) : fromList;
  const note = rawNote ? normalizeNote(rawNote) : undefined;
  const loading = !!token && isLoading && !fromList;

  return {
    note,
    isLoading: loading,
  };
}

export function useTests(classroomId?: string): Test[] {
  const demoTests = useDemo((s) => s.tests);
  const user = useDemo((s) => s.user);
  const token = getToken();

  const { data: serverTests } = useQuery({
    queryKey: queryKeys.tests(classroomId),
    queryFn: () => apiGetTests(classroomId),
    enabled: !!token,
  });

  const tests = user || token ? (serverTests ?? []) : demoTests;
  return useMemo(
    () => (classroomId ? tests.filter((t) => t.classroomId === classroomId) : tests),
    [tests, classroomId],
  );
}

export function useTest(id: string): Test | undefined {
  const tests = useTests();
  return tests.find((t) => t.id === id);
}

export function useSubmissions(): Submission[] {
  const demoSubs = useDemo((s) => s.submissions);
  const user = useDemo((s) => s.user);
  const token = getToken();

  const { data: serverSubs } = useQuery({
    queryKey: queryKeys.submissions(),
    queryFn: apiGetSubmissions,
    enabled: !!token,
  });

  return user || token ? (serverSubs ?? []) : demoSubs;
}

export function useAnalyticsSummary() {
  const token = getToken();
  const user = useDemo((s) => s.user);
  return useQuery({
    queryKey: queryKeys.analyticsSummary(),
    queryFn: apiGetAnalyticsSummary,
    enabled: !!token && user?.role === "teacher",
  });
}

export function useTeacherAnalyticsDashboard() {
  const token = getToken();
  const user = useDemo((s) => s.user);
  return useQuery({
    queryKey: queryKeys.teacherDashboard(),
    queryFn: apiGetTeacherAnalyticsDashboard,
    enabled: !!token && user?.role === "teacher",
    refetchInterval: 60000,
  });
}

export function useStudentMasteryQuery() {
  const token = getToken();
  const user = useDemo((s) => s.user);
  return useQuery({
    queryKey: queryKeys.studentMastery(),
    queryFn: apiGetStudentMastery,
    enabled: !!token && user?.role === "student",
  });
}

export function useStudentConcepts() {
  const token = getToken();
  const user = useDemo((s) => s.user);
  return useQuery({
    queryKey: queryKeys.studentConcepts(user?.id),
    queryFn: apiGetStudentConcepts,
    enabled: !!token && user?.role === "student",
  });
}

export function useClassroomConcepts(classroomId?: string) {
  const token = getToken();
  return useQuery({
    queryKey: queryKeys.classroomConcepts(classroomId),
    queryFn: () => (classroomId ? apiGetClassroomConcepts(classroomId) : Promise.resolve([])),
    enabled: !!token && !!classroomId,
  });
}

export function useStudentClassrooms(): Classroom[] {
  const user = useDemo((s) => s.user);
  const enrolled = useDemo((s) => s.enrolled);
  const all = useClassrooms();
  return useMemo(() => {
    if (user) {
      return all;
    }
    return all.filter((c) => enrolled.includes(c.id));
  }, [all, enrolled, user]);
}

export function useMastery() {
  const user = useDemo((s) => s.user);
  const classes = useStudentClassrooms();
  const tests = useTests();
  const notes = useNotes();
  const { data: serverMastery } = useStudentMasteryQuery();
  const { data: serverConcepts } = useStudentConcepts();
  const demoMastery = useDemo((s) => s.mastery);

  return useMemo(() => {
    if (!user) {
      // Demo Mode
      return concepts.map((c) => {
        const val = demoMastery[c.id] ?? c.mastery;
        return { ...c, mastery: val, state: masteryState(val) };
      });
    }

    // Authenticated real student:
    // Gather concept definitions from serverConcepts (enrolled classrooms) or notes/tests
    const conceptMap = new Map<
      string,
      {
        id: string;
        name: string;
        category: string;
        description: string;
        relatedConceptIds?: string[];
      }
    >();

    if (serverConcepts && serverConcepts.length > 0) {
      serverConcepts.forEach((c) => {
        conceptMap.set(c.id, {
          id: c.id,
          name: c.name,
          category: c.classroomName || "Course Concept",
          description: c.description || c.summary || `Core principles of ${c.name}.`,
          relatedConceptIds: c.relatedConceptIds,
        });
      });
    }

    // Also include any concepts referenced in classrooms, tests, notes, or serverMastery
    const allActiveIds = new Set<string>(conceptMap.keys());
    classes.forEach((c) => c.conceptIds?.forEach((id) => allActiveIds.add(id)));
    tests.forEach((t) => t.conceptIds?.forEach((id) => allActiveIds.add(id)));
    notes.forEach((n) => n.conceptIds?.forEach((id) => allActiveIds.add(id)));
    if (serverMastery) {
      Object.keys(serverMastery).forEach((id) => allActiveIds.add(id));
    }

    allActiveIds.forEach((id) => {
      if (!conceptMap.has(id)) {
        const demoC = conceptById[id];
        if (demoC) {
          conceptMap.set(id, {
            id: demoC.id,
            name: demoC.name,
            category: demoC.category,
            description: demoC.description,
            relatedConceptIds: [],
          });
        } else {
          const prettyName = id
            .replace(/^c-/, "")
            .replace(/-[a-f0-9]{4,8}$/, "")
            .replace(/-/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase());
          conceptMap.set(id, {
            id,
            name: prettyName,
            category: "Course Concept",
            description: `Core principles and practical applications of ${prettyName}.`,
            relatedConceptIds: [],
          });
        }
      }
    });

    if (conceptMap.size === 0) {
      return [];
    }

    return Array.from(conceptMap.values()).map((c) => {
      const val = serverMastery?.[c.id]?.mastery ?? null;
      const trendStr = serverMastery?.[c.id]?.trend;
      const trend = trendStr === "improving" ? 4 : trendStr === "new_gap" ? -3 : 0;
      return {
        id: c.id,
        name: c.name,
        category: c.category,
        description: c.description,
        mastery: val,
        state: masteryState(val),
        trend,
        relatedConceptIds: c.relatedConceptIds || [],
      };
    });
  }, [user, classes, tests, notes, serverMastery, serverConcepts, demoMastery]);
}

export function useOverallMastery() {
  const m = useMastery();
  const assessed = m.filter((c) => c.mastery != null);
  if (assessed.length === 0) return 0;
  return Math.round(assessed.reduce((a, c) => a + (c.mastery ?? 0), 0) / assessed.length);
}

export function useStudentTests() {
  const classes = useStudentClassrooms();
  const tests = useTests();
  const subs = useSubmissions();
  return useMemo(() => {
    const ids = classes.map((c) => c.id);
    const mine = tests.filter((t) => t.status === "published" && ids.includes(t.classroomId));
    const done = new Map(subs.map((s) => [s.testId, s]));
    return {
      upcoming: mine.filter((t) => !done.has(t.id)),
      completed: mine.filter((t) => done.has(t.id)).map((t) => ({ test: t, sub: done.get(t.id)! })),
    };
  }, [classes, tests, subs]);
}

export function useScoreHistory() {
  const user = useDemo((s) => s.user);
  const { completed } = useStudentTests();
  return useMemo(() => {
    if (user) {
      return completed.map((c) => ({
        label: c.test.title,
        date: c.sub.date,
        score: c.sub.score,
      }));
    }
    const extra = completed
      .filter((c) => !arjunHistory.some((h) => h.label === c.test.title))
      .map((c) => ({ label: c.test.title, date: c.sub.date, score: c.sub.score }));
    return [...arjunHistory, ...extra];
  }, [completed, user]);
}

export function useRecommendations() {
  const m = useMastery();
  return useMemo(
    () =>
      m
        .filter((c) => c.mastery != null && c.mastery < 55)
        .sort((a, b) => (a.mastery ?? 0) - (b.mastery ?? 0))
        .slice(0, 5)
        .map((c) => ({
          concept: c,
          ...(tailoredReasons[c.id] ?? {
            why: `Your mastery of ${c.name} is ${c.mastery}% — below the class average.`,
            points: [c.description, "Revisit the worked examples in your class notes.", "Attempt two practice questions before your next test."],
            example: "",
          }),
        })),
    [m],
  );
}

export function classAverageMastery(studentIds: string[]) {
  const list = students.filter((s) => studentIds.includes(s.id));
  if (list.length === 0) return 0;
  return Math.round(list.reduce((a, s) => a + s.mastery, 0) / list.length);
}

export const studentsIn = (ids: string[]) => students.filter((s) => ids.includes(s.id));

export function useNotifications() {
  const token = getToken();
  const user = useDemo((s) => s.user);

  return useQuery({
    queryKey: queryKeys.notifications(),
    queryFn: apiGetNotifications,
    enabled: !!token && !!user,
    refetchInterval: 60000,
  });
}

export function useUnreadNotificationsCount() {
  const token = getToken();
  const user = useDemo((s) => s.user);

  return useQuery({
    queryKey: queryKeys.unreadNotifications(),
    queryFn: apiGetUnreadNotificationsCount,
    enabled: !!token && !!user,
    refetchInterval: 60000,
  });
}

export {
  conceptById,
  apiGetClassroom,
  apiCreateClassroom,
  apiJoinClassroom,
  apiLeaveClassroom,
  apiGetNote,
  apiCreateNote,
  apiUpdateNote,
  apiDeleteNote,
  apiCreateTest,
  apiSubmitTest,
  apiGenerateQuestions,
  apiGetClassroomConcepts,
  apiGetNotifications,
  apiGetUnreadNotificationsCount,
  apiMarkNotificationAsRead,
  apiMarkAllNotificationsAsRead,
};
