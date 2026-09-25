import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { meta } from "@/lib/meta";
import { PageHeader, Section, MasteryBar, Stat } from "@/components/synapse/ui";
import { InkBars } from "@/components/synapse/charts";
import {
  useClassrooms,
  classAverageMastery,
  useSubmissions,
  useTests,
  useAnalyticsSummary,
  useTeacherAnalyticsDashboard,
} from "@/services/synapse";
import { getToken } from "@/api/client";
import { conceptById } from "@/demo/concepts";

export const Route = createFileRoute("/teacher/analytics")({
  head: () => meta("Teaching analytics", "Mastery, performance and weak concepts across all your classrooms."),
  component: Analytics,
});

function Analytics() {
  const classes = useClassrooms();
  const subs = useSubmissions();
  const tests = useTests();
  const { data: serverSummary } = useAnalyticsSummary();
  const { data: dashboard, isLoading: isDashboardLoading } = useTeacherAnalyticsDashboard();
  const token = getToken();

  const summaryConcepts = useMemo(() => {
    if (!serverSummary || serverSummary.length === 0) return [];
    return serverSummary.map((s) => {
      const c = conceptById[s.conceptId];
      return {
        id: s.conceptId,
        name: c?.name ?? s.conceptId,
        category: c?.category ?? "General",
        mastery: Math.round(s.avgMastery * 100),
      };
    });
  }, [serverSummary]);

  const byClass = useMemo(() => {
    if (token && dashboard?.classrooms) {
      return dashboard.classrooms
        .filter((c) => c.studentCount > 0)
        .map((c) => ({
          name: c.name.split(" ").slice(0, 2).join(" "),
          v: c.averageMastery != null ? Math.round(c.averageMastery) : 0,
        }));
    }
    return classes
      .filter((c) => c.studentIds.length)
      .map((c) => ({
        name: c.name.split(" ").slice(0, 2).join(" "),
        v: classAverageMastery(c.studentIds),
      }));
  }, [token, dashboard, classes]);

  const weak = useMemo(() => {
    if (token && dashboard?.concepts) {
      return dashboard.concepts
        .filter((c) => (c.avgMastery ?? 0) < 55)
        .map((c) => ({
          id: c.id,
          name: c.name,
          category: c.category,
          mastery: Math.round(c.avgMastery ?? 0),
        }))
        .sort((a, b) => a.mastery - b.mastery);
    }
    return summaryConcepts
      .filter((c) => c.mastery < 55)
      .sort((a, b) => a.mastery - b.mastery);
  }, [token, dashboard, summaryConcepts]);

  const top = useMemo(() => {
    if (token && dashboard?.leaderboard) {
      return dashboard.leaderboard.map((s) => ({
        id: s.id,
        name: s.name,
        avgScore: Math.round(s.avgScore ?? 0),
      }));
    }
    if (subs.length === 0) return [];
    const map = new Map<string, { total: number; count: number }>();
    for (const s of subs) {
      const cur = map.get(s.studentId) || { total: 0, count: 0 };
      map.set(s.studentId, { total: cur.total + s.score, count: cur.count + 1 });
    }
    return Array.from(map.entries())
      .map(([id, val]) => ({
        id,
        name: id.startsWith("u-") ? `Student ${id.slice(-4)}` : id,
        avgScore: Math.round(val.total / val.count),
      }))
      .sort((a, b) => b.avgScore - a.avgScore);
  }, [token, dashboard, subs]);

  const submissionsCount = token && dashboard ? dashboard.overview.totalSubmissionCount : subs.length;
  const avgScore =
    token && dashboard
      ? dashboard.overview.totalSubmissionCount > 0 && dashboard.overview.averageScore != null
        ? `${Math.round(dashboard.overview.averageScore)}%`
        : "—"
      : subs.length > 0
      ? `${Math.round(subs.reduce((a, s) => a + s.score, 0) / subs.length)}%`
      : "—";

  const testsPublishedCount =
    token && dashboard
      ? dashboard.overview.publishedTestCount
      : tests.filter((t) => t.status === "published").length;

  const weakConceptsCount =
    token && dashboard ? dashboard.overview.weakConceptCount : weak.length;

  return (
    <>
      <PageHeader eyebrow="Insight" title="Teaching analytics">
        How understanding is moving across every class you teach.
      </PageHeader>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Submissions" value={submissionsCount} />
        <Stat label="Avg. score" value={avgScore} />
        <Stat
          label="Tests published"
          value={testsPublishedCount}
        />
        <Stat label="Weak concepts" value={weakConceptsCount} hint="below 55% mastery" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Section title="Mastery by class">
          {byClass.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No classroom mastery data recorded yet.
            </p>
          ) : (
            <InkBars data={byClass} x="name" y="v" label="Average mastery by class" />
          )}
        </Section>
        <Section title="Concepts needing attention">
          {weak.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No concepts currently below 55% mastery threshold.
            </p>
          ) : (
            <ul className="space-y-3">
              {weak.map((c) => (
                <li key={c.id}>
                  <p className="mb-1 text-sm">
                    {c.name} <span className="text-muted-foreground">· {c.category}</span>
                  </p>
                  <MasteryBar value={c.mastery} label={c.name} />
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Student leaderboard" className="lg:col-span-2">
          {top.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No student submissions recorded yet.
            </p>
          ) : (
            <ol className="space-y-2">
              {top.map((s, i) => (
                <li key={s.id} className="flex items-center gap-3 text-sm">
                  <span className="w-5 tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="w-32 shrink-0">{s.name}</span>
                  <div className="flex-1">
                    <MasteryBar value={s.avgScore} label={s.name} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </>
  );
}
