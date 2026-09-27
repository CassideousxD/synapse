import { useState, useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  FileCheck,
  FileText,
  Filter,
  GraduationCap,
  Minus,
  School,
  TrendingDown,
  TrendingUp,
  User,
  Users,
  X,
} from "lucide-react";
import { meta } from "@/lib/meta";
import { cn } from "@/lib/utils";
import { PageHeader, Section, MasteryBar, Stat, Empty } from "@/components/synapse/ui";
import {
  useClassrooms,
  useTeacherAnalyticsDashboard,
} from "@/services/synapse";
import { getToken } from "@/api/client";
import { formatTimeAgo } from "@/lib/deadlines";
import type {
  TeacherConceptMetric,
  TeacherStudentSupportMetric,
  TeacherTestMetric,
  TeacherConceptStudent,
} from "@/api/analytics";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/teacher/analytics")({
  validateSearch: (search: Record<string, unknown>) => ({
    classroom: typeof search.classroom === "string" ? search.classroom : undefined,
  }),
  head: () =>
    meta(
      "Teaching analytics",
      "Actionable classroom mastery, concept gaps, assessment performance and student support.",
    ),
  component: Analytics,
});

function Analytics() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const classroomId = search.classroom;

  const fallbackClasses = useClassrooms();
  const {
    data: dashboard,
    isLoading,
    isError,
    refetch,
  } = useTeacherAnalyticsDashboard(classroomId);
  const token = getToken();

  // Drilldown states for progressive investigation
  const [selectedConcept, setSelectedConcept] = useState<TeacherConceptMetric | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<TeacherStudentSupportMetric | null>(null);
  const [selectedTest, setSelectedTest] = useState<TeacherTestMetric | null>(null);

  // Available classrooms for scope selector
  const availableClassrooms = useMemo(() => {
    if (dashboard?.allClassrooms && dashboard.allClassrooms.length > 0) {
      return dashboard.allClassrooms;
    }
    return fallbackClasses.map((c) => ({ id: c.id, name: c.name, subject: c.subject }));
  }, [dashboard, fallbackClasses]);

  const activeClassroom = useMemo(() => {
    if (!classroomId) return null;
    return availableClassrooms.find((c) => c.id === classroomId) || null;
  }, [classroomId, availableClassrooms]);

  const handleClassroomChange = (val: string) => {
    navigate({
      search: { classroom: val === "all" ? undefined : val },
      replace: true,
    });
  };

  // 1. Overview KPIs
  const studentCount = dashboard?.overview?.studentCount ?? 0;
  const activeStudentCount = dashboard?.overview?.activeStudentCount ?? 0;

  const avgMasteryStr =
    dashboard?.overview?.averageMastery != null
      ? `${Math.round(dashboard.overview.averageMastery)}%`
      : "—";

  const completionPrimary =
    dashboard?.overview?.completionRate != null
      ? `${Math.round(dashboard.overview.completionRate)}%`
      : `${dashboard?.overview?.totalSubmissionCount ?? 0}`;

  const completionHint =
    dashboard?.overview?.completionRate != null
      ? `${dashboard.overview.totalSubmissionCount} of ${dashboard.overview.expectedSubmissionCount ?? 0} expected`
      : "Total submissions received";

  const weakConceptCount = dashboard?.overview?.weakConceptCount ?? 0;

  // 2. Needs Your Attention items
  const strugglingConcepts = useMemo(() => {
    if (!dashboard?.concepts) return [];
    return dashboard.concepts
      .filter((c) => c.avgMastery != null && c.avgMastery < 55)
      .slice(0, 6);
  }, [dashboard]);

  const studentsNeedingSupport = useMemo(() => {
    if (dashboard?.students && dashboard.students.length > 0) {
      return dashboard.students
        .filter((s) => s.weakConceptCount > 0 || (s.avgMastery != null && s.avgMastery < 55))
        .slice(0, 6);
    }
    return [];
  }, [dashboard]);

  return (
    <>
      <div className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Teaching Decision Support
          </p>
          <h1 className="text-3xl font-display md:text-4xl">Teaching analytics</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground text-sm">
            {activeClassroom
              ? `Filtered to ${activeClassroom.name} (${activeClassroom.subject}). Actionable insights for curriculum and student interventions.`
              : "Cross-classroom mastery, critical concept gaps, test performance and student support."}
          </p>
        </div>

        {/* Global Analytics Scope Bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Scope
            </span>
          </div>
          <Select value={classroomId || "all"} onValueChange={handleClassroomChange}>
            <SelectTrigger className="w-[200px] sm:w-[240px] bg-background border-border">
              <SelectValue placeholder="All Classrooms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Classrooms</SelectItem>
              {availableClassrooms.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {classroomId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleClassroomChange("all")}
              className="gap-1 text-xs text-muted-foreground hover:text-foreground h-9 px-2"
            >
              <X className="size-3.5" aria-hidden="true" /> Clear filter
            </Button>
          )}
        </div>
      </div>

      {isLoading && !dashboard && (
        <div className="flex h-64 items-center justify-center">
          <p className="text-muted-foreground animate-pulse text-sm">
            Loading analytics dashboard…
          </p>
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-center text-sm text-foreground my-6">
          <p className="font-medium">Failed to load analytics dashboard data.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-3">
            Retry
          </Button>
        </div>
      )}

      {dashboard && (
        <div className="space-y-8 mt-6">
          {/* 1. Overview KPIs */}
          <section aria-label="Key Performance Indicators">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat
                label="Students"
                value={studentCount}
                hint={`${activeStudentCount} active with assessments`}
              />
              <Stat
                label="Avg. Mastery"
                value={avgMasteryStr}
                hint="Across assessed concepts"
              />
              <Stat
                label="Assessment Completion"
                value={completionPrimary}
                hint={completionHint}
              />
              <Stat
                label="Concepts Needing Attention"
                value={weakConceptCount}
                hint="Below 55% mastery threshold"
              />
            </div>
          </section>

          {/* 2. Needs Your Attention Section */}
          <section aria-labelledby="needs-attention-heading" className="space-y-4">
            <div>
              <h2 id="needs-attention-heading" className="text-2xl font-display">
                Needs Your Attention
              </h2>
              <p className="text-sm text-muted-foreground">
                Priority concepts and students requiring immediate instructional follow-up.
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Card A: Struggling Concepts */}
              <div className="ink-card p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="size-4 text-muted-foreground" aria-hidden="true" />
                      <h3 className="font-display text-lg">Struggling Concepts</h3>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {strugglingConcepts.length} flagged
                    </Badge>
                  </div>

                  {strugglingConcepts.length === 0 ? (
                    <Empty>No concepts currently below the 55% mastery threshold.</Empty>
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {strugglingConcepts.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedConcept(c)}
                            className="group flex w-full items-center justify-between py-3 text-left transition-colors hover:bg-muted/40 px-2 rounded-md"
                          >
                            <div className="flex-1 pr-4 min-w-0">
                              <p className="font-medium text-sm truncate group-hover:underline">
                                {c.name}
                              </p>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                                <span>{c.classroomName || c.category}</span>
                                <span>·</span>
                                <span className="text-foreground font-medium">
                                  {c.strugglingCount} students struggling
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <div className="w-24 hidden sm:block">
                                <MasteryBar value={c.avgMastery} label={c.name} />
                              </div>
                              <TrendBadge trendCounts={c.trendCounts} />
                              <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {strugglingConcepts.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-3 pt-2 border-t border-border">
                    Click any concept to inspect struggling students and misconception details.
                  </p>
                )}
              </div>

              {/* Card B: Students Needing Support */}
              <div className="ink-card p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <GraduationCap className="size-4 text-muted-foreground" aria-hidden="true" />
                      <h3 className="font-display text-lg">Students Needing Support</h3>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {studentsNeedingSupport.length} flagged
                    </Badge>
                  </div>

                  {studentsNeedingSupport.length === 0 ? (
                    <Empty>No students currently identified as requiring support.</Empty>
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {studentsNeedingSupport.map((s) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedStudent(s)}
                            className="group flex w-full items-center justify-between py-3 text-left transition-colors hover:bg-muted/40 px-2 rounded-md"
                          >
                            <div className="flex-1 pr-4 min-w-0">
                              <p className="font-medium text-sm truncate group-hover:underline">
                                {s.name}
                              </p>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                                <span>{s.classroomName || "Enrolled"}</span>
                                <span>·</span>
                                <span className="font-mono text-foreground font-medium">
                                  {s.weakConceptCount} weak concept
                                  {s.weakConceptCount === 1 ? "" : "s"}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <div className="w-24 hidden sm:block">
                                <MasteryBar value={s.avgMastery} label={s.name} />
                              </div>
                              <Badge variant="secondary" className="text-xs font-mono tabular-nums">
                                {s.testsCompleted} test{s.testsCompleted === 1 ? "" : "s"}
                              </Badge>
                              <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {studentsNeedingSupport.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-3 pt-2 border-t border-border">
                    Click any student to review diagnostic concept breakdown and test history.
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* 3. Concept Health Section */}
          <Section
            title="Concept Health"
            action={
              <span className="text-xs text-muted-foreground">
                {dashboard.concepts.length} course concepts total
              </span>
            }
          >
            <p className="text-sm text-muted-foreground mb-4">
              Comprehensive curriculum status showing class mastery, student distributions, and learning trajectories.
            </p>

            {dashboard.concepts.length === 0 ? (
              <Empty>No concept data recorded for this scope.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Concept</TableHead>
                      <TableHead>Classroom</TableHead>
                      <TableHead className="w-44">Average Mastery</TableHead>
                      <TableHead className="text-center">Assessed</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="text-center">Trend</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboard.concepts.map((c) => {
                      const status =
                        c.status ||
                        (c.avgMastery != null && c.avgMastery >= 75
                          ? "Strong"
                          : c.avgMastery != null && c.avgMastery >= 55
                          ? "Developing"
                          : c.avgMastery != null
                          ? "Needs Attention"
                          : "Unassessed");

                      return (
                        <TableRow
                          key={c.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedConcept(c)}
                        >
                          <TableCell className="font-medium text-foreground">
                            {c.name}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {c.classroomName || c.category}
                          </TableCell>
                          <TableCell>
                            <MasteryBar value={c.avgMastery} label={c.name} />
                          </TableCell>
                          <TableCell className="text-center tabular-nums text-xs">
                            {c.studentCount}
                          </TableCell>
                          <TableCell className="text-center">
                            <ConceptStatusBadge status={status} />
                          </TableCell>
                          <TableCell className="text-center">
                            <TrendBadge trendCounts={c.trendCounts} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedConcept(c);
                              }}
                              className="h-8 px-2 text-xs"
                            >
                              Inspect <ArrowRight className="ml-1 size-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          {/* 4. Assessment Performance Section */}
          <Section
            title="Assessment Performance"
            action={
              <span className="text-xs text-muted-foreground">
                {dashboard.tests?.length ?? 0} assessments
              </span>
            }
          >
            <p className="text-sm text-muted-foreground mb-4">
              Real test submission volumes, score distributions, and question-level performance breakdowns.
            </p>

            {!dashboard.tests || dashboard.tests.length === 0 ? (
              <Empty>No assessments have been published yet for this scope.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Assessment Title</TableHead>
                      <TableHead>Classroom</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="text-center">Submissions</TableHead>
                      <TableHead className="w-36">Completion</TableHead>
                      <TableHead className="text-right">Avg. Score</TableHead>
                      <TableHead className="text-center">Late</TableHead>
                      <TableHead className="text-right">Due / Date</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboard.tests.map((t) => (
                      <TableRow
                        key={t.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedTest(t)}
                      >
                        <TableCell className="font-medium text-foreground">
                          {t.title}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t.classroomName}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={t.status === "published" ? "default" : "secondary"}
                            className="capitalize text-[10px] py-0"
                          >
                            {t.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center tabular-nums text-xs">
                          {t.submissionCount} / {t.enrolledCount}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-foreground rounded-full transition-[width]"
                                style={{ width: `${Math.min(100, t.completionRate)}%` }}
                              />
                            </div>
                            <span className="text-xs tabular-nums text-muted-foreground w-8 text-right">
                              {Math.round(t.completionRate)}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {t.averageScore != null ? `${Math.round(t.averageScore)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-center tabular-nums text-xs text-muted-foreground">
                          {t.lateCount > 0 ? (
                            <span className="text-foreground font-medium">{t.lateCount}</span>
                          ) : (
                            "0"
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {t.due || (t.createdAt ? formatTimeAgo(t.createdAt) : "—")}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTest(t);
                            }}
                            className="h-8 px-2 text-xs"
                          >
                            Analysis <ArrowRight className="ml-1 size-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          {/* 5. Classroom Overview (shown when All Classrooms is selected) */}
          {!classroomId && dashboard.classrooms.length > 0 && (
            <Section title="Classroom Performance Overview">
              <p className="text-sm text-muted-foreground mb-4">
                Comparative metrics across your classrooms. Click any classroom to scope analytics or view class details.
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Classroom</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead className="text-center">Enrolled</TableHead>
                      <TableHead className="w-44">Average Mastery</TableHead>
                      <TableHead className="text-center">Tests</TableHead>
                      <TableHead className="text-center">Submissions</TableHead>
                      <TableHead className="text-right">Avg. Score</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboard.classrooms.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium text-foreground">
                          {c.name}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.subject}
                        </TableCell>
                        <TableCell className="text-center tabular-nums text-xs">
                          {c.studentCount}
                        </TableCell>
                        <TableCell>
                          <MasteryBar value={c.averageMastery} label={c.name} />
                        </TableCell>
                        <TableCell className="text-center tabular-nums text-xs">
                          {c.testCount}
                        </TableCell>
                        <TableCell className="text-center tabular-nums text-xs">
                          {c.submissionCount}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {c.averageScore != null ? `${Math.round(c.averageScore)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleClassroomChange(c.id)}
                              className="h-8 px-2.5 text-xs"
                            >
                              Filter Analytics
                            </Button>
                            <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs">
                              <Link to="/teacher/classrooms/$id" params={{ id: c.id }}>
                                Class Page <ExternalLink className="ml-1 size-3" />
                              </Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Section>
          )}

          {/* 6. Recent Activity Feed */}
          {dashboard.recentActivity && dashboard.recentActivity.length > 0 && (
            <Section title="Recent Activity">
              <ul className="divide-y divide-border">
                {dashboard.recentActivity.map((act) => (
                  <li key={act.id} className="py-3 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 rounded-full bg-muted text-muted-foreground">
                        {act.type === "submission" ? (
                          <FileCheck className="size-4" />
                        ) : (
                          <User className="size-4" />
                        )}
                      </div>
                      <div>
                        <span className="font-medium text-foreground">{act.who}</span>{" "}
                        <span className="text-muted-foreground">{act.what}</span>
                        {act.cls && (
                          <span className="text-xs text-muted-foreground/80 ml-1.5">
                            · {act.cls}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {act.timestamp ? formatTimeAgo(act.timestamp) : "Recently"}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* DRILLDOWNS: CONCEPT, STUDENT, AND TEST DRAWERS                            */}
      {/* ========================================================================= */}

      {/* Concept Drilldown Sheet */}
      <Sheet open={!!selectedConcept} onOpenChange={(o) => !o && setSelectedConcept(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selectedConcept && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {selectedConcept.classroomName || selectedConcept.category}
                  </Badge>
                  <ConceptStatusBadge status={selectedConcept.status || "Developing"} />
                </div>
                <SheetTitle className="font-display text-2xl font-normal mt-1">
                  {selectedConcept.name}
                </SheetTitle>
                <SheetDescription>
                  Detailed distribution of student understanding and active learning trajectories.
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-6 mt-6">
                {/* Metric Summary */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="ink-card p-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">
                      Avg. Mastery
                    </p>
                    <p className="text-2xl font-display mt-1">
                      {selectedConcept.avgMastery != null
                        ? `${Math.round(selectedConcept.avgMastery)}%`
                        : "—"}
                    </p>
                  </div>
                  <div className="ink-card p-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">
                      Assessed Students
                    </p>
                    <p className="text-2xl font-display mt-1">
                      {selectedConcept.studentCount}
                    </p>
                  </div>
                  <div className="ink-card p-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                      Struggling (&lt;55%)
                    </p>
                    <p className="text-2xl font-display mt-1 text-foreground">
                      {selectedConcept.strugglingCount}
                    </p>
                  </div>
                  <div className="ink-card p-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                      Proficient (&ge;75%)
                    </p>
                    <p className="text-2xl font-display mt-1 text-foreground">
                      {selectedConcept.proficientCount}
                    </p>
                  </div>
                </div>

                {/* Trend Counts */}
                <div className="ink-card p-4">
                  <h4 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                    Learning Momentum
                  </h4>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-foreground">
                      <TrendingUp className="size-4 text-muted-foreground" /> Improving:{" "}
                      <strong className="font-mono">
                        {selectedConcept.improvingCount ?? selectedConcept.trendCounts?.improving ?? 0}
                      </strong>
                    </span>
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Minus className="size-4" /> Still weak:{" "}
                      <strong className="font-mono">
                        {selectedConcept.stillWeakCount ?? selectedConcept.trendCounts?.still_weak ?? 0}
                      </strong>
                    </span>
                    <span className="flex items-center gap-1.5 text-foreground">
                      <AlertTriangle className="size-4 text-muted-foreground" /> New gap:{" "}
                      <strong className="font-mono">
                        {selectedConcept.newGapCount ?? selectedConcept.trendCounts?.new_gap ?? 0}
                      </strong>
                    </span>
                  </div>
                </div>

                {/* Affected Students List */}
                <div>
                  <h4 className="text-sm font-semibold mb-3 flex items-center justify-between">
                    <span>Enrolled Student Mastery</span>
                    <span className="text-xs text-muted-foreground font-normal">
                      Sorted weakest first
                    </span>
                  </h4>

                  {!selectedConcept.students || selectedConcept.students.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center border border-dashed rounded-md">
                      No individual student assessments recorded on this concept yet.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border border rounded-md overflow-hidden">
                      {selectedConcept.students.map((stu) => (
                        <li
                          key={stu.id}
                          onClick={() => {
                            // Find full student metric if available
                            const fullStu = dashboard?.students?.find((s) => s.id === stu.id);
                            if (fullStu) {
                              setSelectedStudent(fullStu);
                            } else {
                              setSelectedStudent({
                                id: stu.id,
                                name: stu.name,
                                email: stu.email,
                                classroomName: selectedConcept.classroomName || "",
                                avgScore: null,
                                testsCompleted: 0,
                                avgMastery: stu.mastery,
                                weakConceptCount: stu.mastery < 55 ? 1 : 0,
                              });
                            }
                          }}
                          className="p-3 flex items-center justify-between hover:bg-muted/50 cursor-pointer transition-colors"
                        >
                          <div className="flex-1 pr-3">
                            <p className="text-sm font-medium hover:underline">{stu.name}</p>
                            <p className="text-xs text-muted-foreground">{stu.email}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="w-20">
                              <MasteryBar value={stu.mastery} label={stu.name} />
                            </div>
                            <span className="text-xs font-mono text-muted-foreground capitalize">
                              {stu.trend.replace("_", " ")}
                            </span>
                            <ChevronRight className="size-4 text-muted-foreground" />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Student Support Drilldown Sheet */}
      <Sheet open={!!selectedStudent} onOpenChange={(o) => !o && setSelectedStudent(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selectedStudent && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {selectedStudent.classroomName || "Student"}
                  </Badge>
                  {selectedStudent.weakConceptCount > 0 ? (
                    <Badge variant="outline" className="text-xs border-dashed border-foreground text-foreground">
                      {selectedStudent.weakConceptCount} concepts needing support
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">
                      On Track
                    </Badge>
                  )}
                </div>
                <SheetTitle className="font-display text-2xl font-normal mt-1">
                  {selectedStudent.name}
                </SheetTitle>
                <SheetDescription>{selectedStudent.email}</SheetDescription>
              </SheetHeader>

              <div className="space-y-6 mt-6">
                {/* Metric Summary */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="ink-card p-3">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
                      Avg Mastery
                    </p>
                    <p className="text-xl font-display mt-1">
                      {selectedStudent.avgMastery != null
                        ? `${Math.round(selectedStudent.avgMastery)}%`
                        : "—"}
                    </p>
                  </div>
                  <div className="ink-card p-3">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
                      Avg Score
                    </p>
                    <p className="text-xl font-display mt-1">
                      {selectedStudent.avgScore != null
                        ? `${Math.round(selectedStudent.avgScore)}%`
                        : "—"}
                    </p>
                  </div>
                  <div className="ink-card p-3">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
                      Tests Done
                    </p>
                    <p className="text-xl font-display mt-1">{selectedStudent.testsCompleted}</p>
                  </div>
                </div>

                {/* Weak Concepts */}
                <div>
                  <h4 className="text-sm font-semibold mb-2">Concepts Requiring Intervention</h4>
                  {!selectedStudent.weakConcepts || selectedStudent.weakConcepts.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3 px-3 bg-muted/30 rounded border border-border">
                      No concepts currently below the 55% threshold for this student.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {selectedStudent.weakConcepts.map((wc) => (
                        <li
                          key={wc.id}
                          className="p-3 bg-card border rounded-md flex items-center justify-between"
                        >
                          <div>
                            <p className="text-sm font-medium">{wc.name}</p>
                            <span className="text-xs text-muted-foreground capitalize">
                              Trend: {wc.trend.replace("_", " ")}
                            </span>
                          </div>
                          <div className="w-24">
                            <MasteryBar value={wc.mastery} label={wc.name} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Recent Submissions */}
                <div>
                  <h4 className="text-sm font-semibold mb-2">Recent Assessments</h4>
                  {!selectedStudent.recentSubmissions ||
                  selectedStudent.recentSubmissions.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3 px-3 bg-muted/30 rounded border border-border">
                      No assessment submissions recorded yet.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border border rounded-md overflow-hidden">
                      {selectedStudent.recentSubmissions.map((sub, idx) => (
                        <li key={idx} className="p-3 flex items-center justify-between text-sm">
                          <div>
                            <p className="font-medium text-xs">{sub.testTitle}</p>
                            <span className="text-[11px] text-muted-foreground">
                              {sub.submittedAt ? formatTimeAgo(sub.submittedAt) : "Recently"}
                              {sub.isLate && " · Late"}
                            </span>
                          </div>
                          <span className="font-mono font-medium text-xs">
                            {Math.round(sub.score)}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Test Drilldown Sheet */}
      <Sheet open={!!selectedTest} onOpenChange={(o) => !o && setSelectedTest(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selectedTest && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {selectedTest.classroomName}
                  </Badge>
                  <Badge
                    variant={selectedTest.status === "published" ? "default" : "secondary"}
                    className="capitalize text-xs"
                  >
                    {selectedTest.status}
                  </Badge>
                </div>
                <SheetTitle className="font-display text-2xl font-normal mt-1">
                  {selectedTest.title}
                </SheetTitle>
                <SheetDescription>
                  Duration: {selectedTest.durationMin} min · Due: {selectedTest.due}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-6 mt-6">
                {/* Metrics */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="ink-card p-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">
                      Submissions
                    </p>
                    <p className="text-2xl font-display mt-1">
                      {selectedTest.submissionCount}
                      <span className="text-xs font-normal text-muted-foreground ml-1">
                        / {selectedTest.enrolledCount}
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {Math.round(selectedTest.completionRate)}% completed
                    </p>
                  </div>
                  <div className="ink-card p-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">
                      Average Score
                    </p>
                    <p className="text-2xl font-display mt-1">
                      {selectedTest.averageScore != null
                        ? `${Math.round(selectedTest.averageScore)}%`
                        : "—"}
                    </p>
                  </div>
                  <div className="ink-card p-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">
                      Late Turn-Ins
                    </p>
                    <p className="text-2xl font-display mt-1 text-foreground">
                      {selectedTest.lateCount}
                    </p>
                  </div>
                </div>

                {/* Score Distribution */}
                {selectedTest.scoreDistribution && (
                  <div className="ink-card p-4">
                    <h4 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">
                      Score Distribution
                    </h4>
                    <div className="grid grid-cols-4 gap-2 text-center text-xs">
                      {Object.entries(selectedTest.scoreDistribution).map(([band, cnt]) => (
                        <div key={band} className="p-2 bg-muted/40 rounded border border-border/60">
                          <p className="text-muted-foreground font-mono text-[11px]">{band}</p>
                          <p className="text-lg font-display font-medium mt-0.5">{cnt}</p>
                          <p className="text-[10px] text-muted-foreground">students</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Question-Level Analysis */}
                <div>
                  <h4 className="text-sm font-semibold mb-3 flex items-center justify-between">
                    <span>Question Analysis &amp; Common Misconceptions</span>
                    <span className="text-xs text-muted-foreground font-normal">
                      {selectedTest.questions?.length ?? 0} questions
                    </span>
                  </h4>

                  {!selectedTest.questions || selectedTest.questions.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center border border-dashed rounded-md">
                      No questions recorded for this assessment.
                    </p>
                  ) : (
                    <ul className="space-y-4">
                      {selectedTest.questions.map((q) => {
                        const pct = q.correctPercentage;
                        const isWeak = pct != null && pct < 55;
                        const isStrong = pct != null && pct >= 75;

                        return (
                          <li
                            key={q.id}
                            className="p-4 rounded-lg border bg-card/60 space-y-2.5 text-sm"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <span className="font-mono text-xs font-semibold text-muted-foreground">
                                Q{q.index}
                              </span>
                              <div className="flex-1">
                                <p className="font-medium text-foreground">{q.prompt}</p>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                                  <span className="bg-muted px-1.5 py-0.5 rounded text-[11px]">
                                    {q.conceptName}
                                  </span>
                                  <span>·</span>
                                  <span className="capitalize text-[11px]">{q.type}</span>
                                </div>
                              </div>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "tabular-nums text-xs font-mono shrink-0",
                                  isWeak && "border-dashed border-foreground text-foreground",
                                  isStrong && "bg-foreground text-background border-transparent",
                                  !isWeak && !isStrong && "border-border text-foreground",
                                )}
                              >
                                {pct != null ? `${Math.round(pct)}% correct` : "Unanswered"}
                              </Badge>
                            </div>

                            <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 pt-1 border-t border-border/50">
                              <span>
                                Answered:{" "}
                                <strong className="text-foreground">
                                  {q.correctCount}/{q.answeredCount}
                                </strong>
                              </span>
                              <span>
                                Expected:{" "}
                                <span className="font-mono text-foreground font-medium">
                                  {q.expectedAnswer}
                                </span>
                              </span>
                            </div>

                            {/* Distractor / Common Mistakes */}
                            {q.commonMistakes && q.commonMistakes.length > 0 && (
                              <div className="mt-2 bg-muted/40 p-2.5 rounded text-xs">
                                <p className="font-medium text-muted-foreground mb-1 text-[11px] uppercase tracking-wider">
                                  Common Incorrect Selections:
                                </p>
                                <ul className="space-y-1">
                                  {q.commonMistakes.map((m, mIdx) => (
                                    <li
                                      key={mIdx}
                                      className="flex items-center justify-between text-muted-foreground"
                                    >
                                      <span className="font-mono text-[11px] truncate max-w-[280px]">
                                        &ldquo;{m.answer}&rdquo;
                                      </span>
                                      <span className="text-[11px] tabular-nums font-medium text-foreground">
                                        {m.count} student{m.count === 1 ? "" : "s"}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function TrendBadge({ trendCounts }: { trendCounts?: Record<string, number> }) {
  if (!trendCounts) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const imp = trendCounts.improving || 0;
  const gap = trendCounts.new_gap || 0;
  const weak = trendCounts.still_weak || 0;

  if (gap > 0 && gap >= imp) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-foreground font-medium">
        <AlertTriangle className="size-3.5 text-muted-foreground" /> New gap
      </span>
    );
  }
  if (imp > weak) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-foreground font-medium">
        <TrendingUp className="size-3.5 text-muted-foreground" /> Improving
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Minus className="size-3.5" /> Still weak
    </span>
  );
}

function ConceptStatusBadge({ status }: { status: string }) {
  if (status === "Strong") {
    return (
      <Badge className="bg-foreground text-background hover:bg-foreground/90 text-[11px] py-0 border-transparent">
        Strong
      </Badge>
    );
  }
  if (status === "Needs Attention") {
    return (
      <Badge variant="outline" className="border-dashed border-foreground text-foreground text-[11px] py-0">
        Needs Attention
      </Badge>
    );
  }
  if (status === "Developing") {
    return (
      <Badge variant="outline" className="text-[11px] py-0 border-foreground/40 text-foreground">
        Developing
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-[11px] py-0 text-muted-foreground">
      {status}
    </Badge>
  );
}
