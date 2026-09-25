import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { meta } from "@/lib/meta";
import { PageHeader, ConceptChip } from "@/components/synapse/ui";
import { useTests, useSubmissions, useClassrooms } from "@/services/synapse";
import { formatDeadline } from "@/lib/deadlines";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/teacher/tests/")({
  head: () => meta("Tests", "All assessments across your classrooms with submission statistics."),
  component: Tests,
});

function Tests() {
  const tests = useTests();
  const subs = useSubmissions();
  const classes = useClassrooms();
  return (
    <>
      <PageHeader eyebrow="Assessment" title="Tests" actions={<Button asChild><Link to="/teacher/tests/new"><Plus className="size-4" aria-hidden="true" /> Create test</Link></Button>}>
        Published and draft assessments, with how each class is doing.
      </PageHeader>
      {tests.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <h3 className="font-display text-lg">No tests created yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create an assessment to evaluate students and measure concept mastery.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tests.map((t) => {
            const ss = subs.filter((s) => s.testId === t.id);
            return (
              <li key={t.id} className="ink-card ink-hover flex flex-col p-5">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <span>{classes.find((c) => c.id === t.classroomId)?.name}</span>
                  <span className={t.status === "published" ? "text-foreground" : ""}>{t.status}</span>
                </div>
                <h2 className="mt-2 text-xl">{t.title}</h2>
                <p className="text-sm text-muted-foreground">
                  {t.questions.length} questions · {t.durationMin} min · {formatDeadline(t.due, t.dueAt).formatted.toLowerCase()}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">{t.conceptIds.map((id) => <ConceptChip key={id} id={id} to="none" />)}</div>
                <div className="mt-auto pt-4 text-sm">
                  <p>{ss.length} submissions{ss.length > 0 && <> · avg <span className="tabular-nums">{Math.round(ss.reduce((a, s) => a + s.score, 0) / ss.length)}%</span></>}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
