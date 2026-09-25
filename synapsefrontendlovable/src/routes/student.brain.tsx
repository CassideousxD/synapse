import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { z } from "zod";
import { Sparkles } from "lucide-react";
import { meta } from "@/lib/meta";
import { PageHeader, MasteryBar, ConceptChip } from "@/components/synapse/ui";
import { useRecommendations, useNotes } from "@/services/synapse";
import { neighbours } from "@/demo/concepts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PracticeButton } from "@/components/synapse/PracticeButton";

export const Route = createFileRoute("/student/brain")({
  validateSearch: z.object({ c: z.string().optional() }),
  head: () => meta("Tailored revision", "Personalised revision notes generated from your recent performance."),
  component: Brain,
});

function Brain() {
  const recs = useRecommendations();
  const notes = useNotes();
  const { c } = Route.useSearch();
  const active = recs.find((r) => r.concept.id === c) ?? recs[0];
  const src = active && notes.find((n) => n?.published && Array.isArray(n?.conceptIds) && n.conceptIds.includes(active.concept.id));

  return (
    <>
      <PageHeader eyebrow="Your tailored revision" title="What to revisit next">Based on your recent tests, reading and graph activity.</PageHeader>
      {recs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <h3 className="font-display text-lg">No revision recommendations yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete learning sessions or tests to receive tailored revision notes based on your concept mastery.
          </p>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[18rem_1fr]">
          <ol className="space-y-2" aria-label="Recommendations">
            {recs.map((r, i) => (
              <li key={r.concept.id}>
                <Link to="/student/brain" search={{ c: r.concept.id }} aria-current={active?.concept.id === r.concept.id ? "true" : undefined}
                  className={cn("ink-card ink-hover block p-4", active?.concept.id === r.concept.id && "border-foreground")}>
                  <p className="text-xs text-muted-foreground">{i + 1}</p>
                  <p className="font-display text-lg">{r.concept.name}</p>
                  <div className="mt-2"><MasteryBar value={r.concept.mastery} label={r.concept.name} /></div>
                </Link>
              </li>
            ))}
          </ol>

          <AnimatePresence mode="wait">
            {active && (
              <motion.article key={active.concept.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="ink-card max-w-[72ch] p-6 md:p-8">
                <p className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground"><Sparkles className="size-3.5" aria-hidden="true" /> Generated for you · {active.concept.category}</p>
                <h2 className="mt-2 text-4xl">{active.concept.name}</h2>
                <p className="mt-4 text-lg leading-8">{active.concept.description}</p>

                <div className="mt-6 rounded-md border border-dashed border-border p-4">
                  <h3 className="text-lg">Why you're seeing this</h3>
                  <p className="mt-1 text-muted-foreground">{active.why}</p>
                </div>

                <h3 className="mt-8 text-xl">Important points</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5">{active.points.map((p) => <li key={p}>{p}</li>)}</ul>

                {active.example && (
                  <>
                    <h3 className="mt-8 text-xl">Example</h3>
                    <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-4 font-mono text-sm leading-6"><code>{active.example}</code></pre>
                  </>
                )}

                <h3 className="mt-8 text-xl">Related concepts</h3>
                <div className="mt-2 flex flex-wrap gap-1.5">{neighbours(active.concept.id).map((n) => <ConceptChip key={n} id={n} />)}</div>

                <div className="mt-8 flex flex-wrap gap-2">
                  {src && <Button asChild variant="outline"><Link to="/student/notes/$id" params={{ id: src.id }}>Open original notes</Link></Button>}
                  <Button asChild variant="outline"><Link to="/student/graph" search={{ focus: active.concept.id }}>Show on graph</Link></Button>
                  <PracticeButton conceptId={active.concept.id} />
                </div>
              </motion.article>
            )}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}

