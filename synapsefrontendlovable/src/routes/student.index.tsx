import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { meta } from "@/lib/meta";
import { PageHeader, Section, Stat, MasteryBar } from "@/components/synapse/ui";
import { JoinClass } from "@/components/synapse/JoinClass";
import { formatDeadline } from "@/lib/deadlines";
import { cn } from "@/lib/utils";
import { useStudentClassrooms, useStudentTests, useOverallMastery, useRecommendations, useScoreHistory, useCurrentStudent } from "@/services/synapse";
import { useDemo } from "@/stores/demo-store";

export const Route = createFileRoute("/student/")({
  head: () => meta("Today", "Your classes, upcoming tests, recent scores and what to revise next."),
  component: StudentHome,
});

function StudentHome() {
  const user = useDemo((s) => s.user);
  const me = useCurrentStudent();
  const classes = useStudentClassrooms();
  const { upcoming, completed } = useStudentTests();
  const overall = useOverallMastery();
  const recs = useRecommendations();
  const history = useScoreHistory();
  return (
    <>
      <PageHeader eyebrow="Today" title={`Welcome back, ${me.name.split(" ")[0]}`}>
        {recs[0] ? <>Your graph suggests starting with <em className="text-foreground">{recs[0].concept.name}</em> today.</> : "Here is your learning overview."}
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Overall mastery" value={`${overall}%`} />
        <Stat label="Classes" value={classes.length} />
        <Stat label="Upcoming tests" value={upcoming.length} />
        <Stat label="Last score" value={history.length > 0 ? `${history.at(-1)?.score}%` : "—"} hint={history.at(-1)?.label || "No tests yet"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Section title="Upcoming tests" className="lg:col-span-2">
          {upcoming.length === 0 ? <p className="text-sm text-muted-foreground">Nothing due — nicely done.</p> : (
            <ul className="divide-y divide-border">
              {upcoming.map((t) => {
                const deadline = formatDeadline(t.due, t.dueAt);
                return (
                  <li key={t.id}>
                    <Link to="/student/tests/$id" params={{ id: t.id }} className="group flex items-center justify-between gap-4 py-3">
                      <div>
                        <p className="font-display text-lg">{t.title}</p>
                        <p className="text-sm text-muted-foreground">{classes.find((c) => c.id === t.classroomId)?.name} · {t.questions.length} questions · {t.durationMin} min</p>
                      </div>
                      <span className={cn("flex shrink-0 items-center gap-2 text-sm", deadline.isOverdue ? "text-destructive font-medium" : "text-muted-foreground")}>
                        {deadline.formatted}
                        <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
        <JoinClass />

        <Section title="Concepts to review" action={<Link to="/student/brain" className="text-sm text-muted-foreground hover:text-foreground">Tailored revision</Link>}>
          {recs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Take a test to see tailored concept recommendations.</p>
          ) : (
            <ul className="space-y-3">
              {recs.slice(0, 4).map((r) => (
                <li key={r.concept.id}>
                  <Link to="/student/brain" search={{ c: r.concept.id }} className="block rounded-md p-1 hover:bg-muted">
                    <p className="mb-1 text-sm">{r.concept.name}</p><MasteryBar value={r.concept.mastery} label={r.concept.name} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Enrolled classes">
          {classes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No classes yet. Enter a class code above to join.</p>
          ) : (
            <ul className="space-y-2">
              {classes.map((c) => (
                <li key={c.id}><Link to="/student/classrooms/$id" params={{ id: c.id }} className="flex justify-between rounded-md p-2 hover:bg-muted"><span>{c.name}</span><ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" /></Link></li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Recent scores">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No test scores recorded yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {[...history].reverse().slice(0, 5).map((h) => <li key={h.label} className="flex justify-between"><span>{h.label} <span className="text-muted-foreground">· {h.date}</span></span><span className="tabular-nums">{h.score}%</span></li>)}
            </ul>
          )}
        </Section>

        <Section title="Recent learning activity" className="lg:col-span-3">
          {user ? (
            completed.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent activity yet. Join a classroom or take a test to start building your knowledge graph.</p>
            ) : (
              <ul className="grid gap-3 text-sm md:grid-cols-3">
                {completed.map(({ test, sub }) => (
                  <li key={test.id} className="rounded-md border border-border p-3">
                    Completed <span className="text-foreground">{test.title}</span> — {sub.score}%
                  </li>
                ))}
              </ul>
            )
          ) : (
            <ul className="grid gap-3 text-sm md:grid-cols-3">
              {completed.slice(-1).map(({ test, sub }) => <li key={test.id} className="rounded-md border border-border p-3">Completed <span className="text-foreground">{test.title}</span> — {sub.score}%</li>)}
              <li className="rounded-md border border-border p-3">Read <Link to="/student/notes/$id" params={{ id: "graphs" }} className="underline underline-offset-4">Graphs</Link> · 18 minutes</li>
              <li className="rounded-md border border-border p-3">Explored <Link to="/student/graph" search={{ focus: "binary-search" }} className="underline underline-offset-4">Binary Search</Link> on your graph</li>
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
