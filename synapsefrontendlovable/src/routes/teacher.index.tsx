import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { meta } from "@/lib/meta";
import { PageHeader, Section, Stat, MasteryBar } from "@/components/synapse/ui";
import {
  useClassrooms,
  useTests,
  useAnalyticsSummary,
  classAverageMastery,
  useTeacher,
  useTeacherAnalyticsDashboard,
} from "@/services/synapse";
import { getToken } from "@/api/client";
import { conceptById } from "@/demo/concepts";
import { formatTimeAgo } from "@/lib/deadlines";

export const Route = createFileRoute("/teacher/")({
  head: () => meta("Teacher overview", "Your classrooms, assessments and concepts that need attention."),
  component: TeacherHome,
});

function TeacherHome() {
  const t = useTeacher();
  const classes = useClassrooms();
  const tests = useTests();
  const { data: serverSummary } = useAnalyticsSummary();
  const { data: dashboard } = useTeacherAnalyticsDashboard();
  const token = getToken();

  const isReal = !!token && !!dashboard;

  const totalClasses = isReal ? dashboard.overview.classroomCount : classes.length;
  const totalStudents = isReal
    ? dashboard.overview.studentCount
    : new Set(classes.flatMap((c) => c.studentIds)).size;
  const active = tests.filter((x) => x.status === "published");
  const totalActiveTests = isReal ? dashboard.overview.publishedTestCount : active.length;
  const avg = isReal
    ? dashboard.overview.averageMastery != null
      ? Math.round(dashboard.overview.averageMastery)
      : 0
    : serverSummary && serverSummary.length > 0
    ? Math.round(
        serverSummary.reduce((a, s) => a + s.avgMastery * 100, 0) /
          serverSummary.length,
      )
    : totalStudents > 0
    ? classAverageMastery(classes.flatMap((c) => c.studentIds))
    : 0;

  const classroomMasteryMap = useMemo(() => {
    const map = new Map<string, number>();
    if (dashboard?.classrooms) {
      for (const c of dashboard.classrooms) {
        if (c.averageMastery != null) {
          map.set(c.id, Math.round(c.averageMastery));
        }
      }
    }
    return map;
  }, [dashboard]);

  const weak = useMemo(() => {
    if (isReal && dashboard?.concepts) {
      return dashboard.concepts
        .filter((c) => (c.avgMastery ?? 0) < 55)
        .slice(0, 5)
        .map((c) => ({
          c: { id: c.id, name: c.name },
          v: Math.round(c.avgMastery ?? 0),
        }));
    }
    return (serverSummary ?? [])
      .filter((s) => s.avgMastery < 0.55)
      .map((s) => ({
        c: conceptById[s.conceptId] ?? { id: s.conceptId, name: s.conceptId },
        v: Math.round(s.avgMastery * 100),
      }))
      .sort((a, b) => a.v - b.v)
      .slice(0, 5);
  }, [isReal, dashboard, serverSummary]);

  const activity = useMemo(() => {
    if (isReal && dashboard?.recentActivity) {
      return dashboard.recentActivity.map((a) => ({
        id: a.id,
        who: a.who,
        what: a.what,
        cls: a.cls,
        when: a.timestamp ? formatTimeAgo(a.timestamp) : "Recently",
      }));
    }
    return classes
      .flatMap((c) => (c.activity || []).map((a) => ({ ...a, cls: c.name })))
      .slice(0, 6);
  }, [isReal, dashboard, classes]);

  return (
    <>
      <PageHeader eyebrow="Teacher Overview" title={`Welcome, ${t.name.split(" ").slice(0, 2).join(" ")}`}>
        {t.department}. Here is where your classes stand this week.
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Classes" value={totalClasses} />
        <Stat label="Students" value={totalStudents} />
        <Stat label="Active tests" value={totalActiveTests} />
        <Stat label="Avg. mastery" value={`${avg}%`} hint="across all classes" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Section title="Your classrooms" className="lg:col-span-2" action={<Link to="/teacher/classrooms" className="text-sm text-muted-foreground hover:text-foreground">View all</Link>}>
          {classes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No classrooms yet. Create your first classroom to get started.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {classes.map((c) => (
                <li key={c.id}>
                  <Link to="/teacher/classrooms/$id" params={{ id: c.id }} className="group flex items-center gap-4 py-4">
                    <div className="flex-1">
                      <p className="font-display text-lg">{c.name}</p>
                      <p className="text-sm text-muted-foreground">{c.studentIds.length} students · code <span className="font-mono">{c.joinCode}</span></p>
                    </div>
                    <div className="hidden w-40 sm:block">
                      <MasteryBar
                        value={
                          isReal
                            ? (classroomMasteryMap.get(c.id) ?? null)
                            : (c.studentIds.length ? classAverageMastery(c.studentIds) : null)
                        }
                        label={c.name}
                      />
                    </div>
                    <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Needs attention">
          {weak.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No concepts need attention yet. Concepts will appear here as students complete assessments.
            </p>
          ) : (
            <ul className="space-y-3">
              {weak.map(({ c, v }) => (
                <li key={c.id}>
                  <p className="mb-1 text-sm">{c.name}</p>
                  <MasteryBar value={v} label={c.name} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Recent activity" className="lg:col-span-2">
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recent activity yet. Student submissions and updates will appear here.
            </p>
          ) : (
            <ul className="space-y-3">
              {activity.map((a) => (
                <li key={a.id} className="flex items-baseline justify-between gap-4 border-b border-border pb-3 last:border-0">
                  <p><span className="text-foreground">{a.who}</span> <span className="text-muted-foreground">{a.what}{a.cls ? ` · ${a.cls}` : ""}</span></p>
                  <span className="shrink-0 text-xs text-muted-foreground">{a.when}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Upcoming assessments">
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active tests. Create an assessment for your classroom.
            </p>
          ) : (
            <ul className="space-y-3">
              {active.slice(0, 5).map((x) => (
                <li key={x.id} className="flex justify-between gap-2 text-sm">
                  <span>{x.title}</span><span className="shrink-0 text-muted-foreground">Due {x.due}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
