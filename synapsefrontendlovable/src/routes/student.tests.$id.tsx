import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Clock, X, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { meta } from "@/lib/meta";
import { ConceptChip, Section, MasteryBar } from "@/components/synapse/ui";
import { useTest, apiSubmitTest, invalidateQueries } from "@/services/synapse";
import { useDemo, type TestResult } from "@/stores/demo-store";
import { getToken } from "@/api/client";
import { conceptById } from "@/demo/concepts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/student/tests/$id")({
  head: () => meta("Test", "Take your assigned test and see how your mastery changes."),
  component: TakeTest,
});

function TakeTest() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const test = useTest(id);
  const submit = useDemo((s) => s.submitTest);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<TestResult | null>(null);
  const [left, setLeft] = useState((test?.durationMin ?? 20) * 60);
  const [isSubmitting, setIsSubmitting] = useState(false);
  useEffect(() => {
    if (result) return;
    const t = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(t);
  }, [result]);
  if (!test) throw notFound();
  if (result) return <Results test={test} result={result} answers={answers} />;

  const q = test.questions[i]!;
  const answered = Object.values(answers).filter(Boolean).length;
  const mm = String(Math.floor(left / 60)).padStart(2, "0"), ss = String(left % 60).padStart(2, "0");
  const finish = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    const token = getToken();
    if (token) {
      try {
        const res = await apiSubmitTest(test.id, answers);
        if (res && res.score !== undefined) {
          setResult(res);
          await invalidateQueries.testSubmitted(queryClient, test.id);
          if (res.isLate || res.status === "submitted_late") {
            toast.warning(`Test submitted late. Score: ${res.score}%`);
          } else {
            toast.success(`Test completed! Score: ${res.score}%`);
          }
          return;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to submit test";
        toast.error(msg);
        setIsSubmitting(false);
        return;
      }
    }
    const r = submit(test.id, answers);
    setResult(r);
    toast.success(`Test completed! Score: ${r.score}%`);
    setIsSubmitting(false);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Test</p><h1 className="text-2xl md:text-3xl">{test.title}</h1></div>
        <p className="flex items-center gap-2 rounded-full border border-border px-3 py-1 font-mono text-sm tabular-nums" role="timer" aria-label={`Time remaining ${mm} minutes ${ss} seconds`}>
          <Clock className="size-4" aria-hidden="true" />{mm}:{ss}
        </p>
      </div>
      <Progress value={(answered / test.questions.length) * 100} aria-label={`${answered} of ${test.questions.length} answered`} className="mb-2 h-1" />
      <nav aria-label="Questions" className="mb-8 flex flex-wrap gap-1.5">
        {test.questions.map((x, k) => (
          <button key={x.id} type="button" onClick={() => setI(k)} aria-current={k === i ? "step" : undefined} aria-label={`Question ${k + 1}${answers[x.id] ? ", answered" : ""}`}
            className={cn("size-8 rounded-full border text-xs transition-all hover:-translate-y-px", k === i ? "border-foreground" : "border-border", answers[x.id] && "bg-foreground text-background")}>
            {k + 1}
          </button>
        ))}
      </nav>

      <AnimatePresence mode="wait">
        <motion.fieldset key={q.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }} className="ink-card p-6">
          <legend className="sr-only">Question {i + 1}</legend>
          <p className="text-sm text-muted-foreground">Question {i + 1} of {test.questions.length} · {conceptById[q.conceptId]?.name}</p>
          <p className="mt-3 font-display text-2xl leading-snug">{q.prompt}</p>
          {q.type === "mcq" ? (
            <div role="radiogroup" aria-label="Answer options" className="mt-6 grid gap-2">
              {q.options!.map((o, k) => {
                const on = answers[q.id] === o;
                return (
                  <motion.button key={o} type="button" role="radio" aria-checked={on} whileTap={{ scale: 0.99 }} onClick={() => setAnswers({ ...answers, [q.id]: o })}
                    className={cn("flex items-center gap-3 rounded-md border px-4 py-3 text-left transition-all hover:-translate-y-px", on ? "border-foreground bg-accent" : "border-border hover:border-ink-soft")}>
                    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-xs", on ? "border-foreground bg-foreground text-background" : "border-border")}>{String.fromCharCode(65 + k)}</span>
                    {o}
                  </motion.button>
                );
              })}
            </div>
          ) : (
            <div className="mt-6"><label htmlFor={`sa-${q.id}`} className="text-sm text-muted-foreground">Your answer</label><Input id={`sa-${q.id}`} className="mt-1" value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} /></div>
          )}
        </motion.fieldset>
      </AnimatePresence>

      <div className="mt-6 flex justify-between">
        <Button variant="outline" disabled={i === 0} onClick={() => setI(i - 1)}>Previous</Button>
        {i < test.questions.length - 1 ? <Button onClick={() => setI(i + 1)}>Next</Button> : (
          <AlertDialog>
            <AlertDialogTrigger asChild><Button>Submit test</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display text-2xl font-normal">Submit your answers?</AlertDialogTitle>
                <AlertDialogDescription>You've answered {answered} of {test.questions.length} questions. You can't change answers after submitting.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isSubmitting}>Keep working</AlertDialogCancel>
                <AlertDialogAction disabled={isSubmitting} onClick={finish}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Submit"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}

function Results({ test, result, answers }: { test: NonNullable<ReturnType<typeof useTest>>; result: TestResult; answers: Record<string, string> }) {
  const weak = Object.entries(result.masteryChanges).filter(([, d]) => d < 0).map(([k]) => k);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Results · {test.title}</p>
        <p className="mt-4 font-display text-8xl" aria-label={`Score ${result.score} percent`}>{result.score}%</p>
        <p className="mt-2 text-muted-foreground">{result.correct.length} correct · {result.incorrect.length} to revisit</p>
        {(result.isLate || result.status === "submitted_late") && (
          <span className="inline-block mt-3 px-3 py-1 rounded-full text-xs font-medium border border-destructive/40 text-destructive bg-destructive/10">
            Submitted late (after deadline)
          </span>
        )}
      </motion.div>
      <Section title="Questions">
        <ol className="space-y-3">
          {test.questions.map((q, k) => {
            const ok = result.correct.includes(q.id);
            return (
              <li key={q.id} className="flex gap-3 border-b border-border pb-3 last:border-0">
                <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border", ok ? "border-foreground bg-foreground text-background" : "border-dashed border-foreground")} aria-label={ok ? "Correct" : "Incorrect"}>
                  {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                </span>
                <div><p>{k + 1}. {q.prompt}</p>{!ok && <p className="text-sm text-muted-foreground">Your answer: {answers[q.id] || "—"} · Correct: {q.answer}</p>}</div>
              </li>
            );
          })}
        </ol>
      </Section>
      <Section title="Mastery changes">
        {result.detailedMasteryChanges && result.detailedMasteryChanges.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {result.detailedMasteryChanges.map((mc) => (
              <div key={mc.conceptId} className="rounded-md border border-border p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">{mc.conceptName}</span>
                  <span className={cn(
                    "text-xs font-semibold px-2 py-0.5 rounded-full font-mono",
                    mc.change > 0 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" :
                    mc.change < 0 ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" :
                    "bg-muted text-muted-foreground"
                  )}>
                    {mc.change > 0 ? `+${mc.change}%` : `${mc.change}%`}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Previous: <strong className="text-foreground">{mc.previousMastery}%</strong></span>
                  <span>New: <strong className="text-foreground">{mc.newMastery}%</strong></span>
                  <span>Test: {mc.performance}</span>
                </div>
                <MasteryBar value={mc.newMastery} label={mc.conceptName} />
              </div>
            ))}
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {Object.entries(result.masteryChanges).map(([k, d]) => (
              <li key={k} className="flex justify-between rounded-md border border-border px-3 py-2 text-sm">
                <span>{conceptById[k]?.name || k}</span>
                <span className="tabular-nums">{d > 0 ? `+${d}%` : `${d}%`}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {result.revisionConcepts && result.revisionConcepts.length > 0 ? (
        <Section title="Concepts needing revision">
          <div className="grid gap-3 sm:grid-cols-2">
            {result.revisionConcepts.map((rc) => (
              <div key={rc.conceptId} className="rounded-md border border-border p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Link
                    to="/student/brain"
                    search={{ c: rc.conceptId }}
                    className="font-medium text-foreground hover:underline"
                  >
                    {rc.conceptName}
                  </Link>
                  <span className="text-xs text-muted-foreground font-mono">
                    Mastery: {rc.currentMastery}%
                  </span>
                </div>
                <p className="text-xs text-destructive font-medium">{rc.reason}</p>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">Recent: {rc.recentPerformance}</span>
                  <Link
                    to="/student/brain"
                    search={{ c: rc.conceptId }}
                    className="text-xs underline underline-offset-4 text-primary hover:text-primary/80"
                  >
                    Review concept →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : weak.length > 0 ? (
        <Section title="Concepts needing revision">
          <div className="flex flex-wrap gap-2">
            {weak.map((k) => (
              <Link key={k} to="/student/brain" search={{ c: k }} className="rounded-full border border-foreground px-3 py-1 text-sm hover:bg-accent">
                {conceptById[k]?.name || k}
              </Link>
            ))}
          </div>
        </Section>
      ) : null}
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild variant="outline"><Link to="/student">Back to today</Link></Button>
        <Button asChild><Link to="/student/graph">See your updated graph</Link></Button>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">{test.conceptIds.map((c) => <ConceptChip key={c} id={c} />)}</div>
    </div>
  );
}
