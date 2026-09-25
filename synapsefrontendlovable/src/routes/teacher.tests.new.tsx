import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Check, Plus, Trash2, Loader2, Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { meta } from "@/lib/meta";
import { PageHeader, Section } from "@/components/synapse/ui";
import {
  useClassrooms,
  useClassroomConcepts,
  apiCreateTest,
  apiGenerateQuestions,
  invalidateQueries,
} from "@/services/synapse";
import { useDemo } from "@/stores/demo-store";
import { getToken } from "@/api/client";
import { conceptById } from "@/demo/concepts";
import type { Question } from "@/demo/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/teacher/tests/new")({
  validateSearch: z.object({ classroom: z.string().optional() }),
  head: () => meta("Create test", "Build a new assessment: pick concepts, write questions, configure and publish."),
  component: NewTest,
});

const STEPS = ["Classroom", "Concepts", "Questions", "Configure", "Preview"] as const;

function NewTest() {
  const queryClient = useQueryClient();
  const { classroom } = Route.useSearch();
  const classes = useClassrooms();
  const save = useDemo((s) => s.saveTest);
  const navigate = useNavigate();
  const [step, setStep] = useState(classroom ? 1 : 0);
  const [cls, setCls] = useState(classroom ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [qs, setQs] = useState<Question[]>([]);
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(20);
  const defaultDueAt = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    d.setHours(23, 59, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);
  const [dueAt, setDueAt] = useState<string>(defaultDueAt);
  const [due, setDue] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  });
  const [isPublishing, setIsPublishing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const room = classes.find((c) => c.id === cls);
  const { data: classroomConcepts = [] } = useClassroomConcepts(cls);

  const availableConcepts = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    if (classroomConcepts && classroomConcepts.length > 0) {
      classroomConcepts.forEach((c) => map.set(c.id, { id: c.id, name: c.name }));
    }
    if (room?.conceptIds) {
      room.conceptIds.forEach((id) => {
        if (!map.has(id)) {
          const demoC = conceptById[id];
          const prettyName =
            demoC?.name ||
            id
              .replace(/^c-/, "")
              .replace(/-[a-f0-9]{4,8}$/, "")
              .replace(/-/g, " ")
              .replace(/\b\w/g, (l) => l.toUpperCase());
          map.set(id, { id, name: prettyName });
        }
      });
    }
    return Array.from(map.values());
  }, [classroomConcepts, room]);

  const addQ = (type: "mcq" | "short") =>
    setQs([...qs, { id: `q${Date.now()}`, type, prompt: "", options: type === "mcq" ? ["", "", "", ""] : undefined, answer: "", conceptId: picked[0] ?? "" }]);
  const upd = (i: number, p: Partial<Question>) => setQs(qs.map((q, j) => (j === i ? { ...q, ...p } : q)));

  const handleGenerateAI = async () => {
    if (isGenerating || picked.length === 0) return;
    setIsGenerating(true);
    try {
      const token = getToken();
      if (token) {
        const generated = await apiGenerateQuestions({
          classroomId: cls,
          conceptIds: picked,
          count: Math.max(3, picked.length),
        });
        if (generated.length) {
          setQs([...qs, ...generated]);
          toast.success(`Generated ${generated.length} questions from extracted concepts`);
        }
      } else {
        toast.info("AI question generation requires an active session");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate questions";
      toast.error(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const canNext = [!!cls, picked.length > 0, qs.length > 0 && qs.every((q) => q.prompt && q.answer), !!title && duration > 0, true][step];

  const publish = async (status: "published" | "draft") => {
    if (isPublishing) return;
    setIsPublishing(true);
    const testData = {
      id: `t-${Date.now()}`,
      title,
      classroomId: cls,
      conceptIds: picked,
      durationMin: duration,
      due,
      dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      status,
      questions: qs,
    };
    const token = getToken();
    if (token) {
      try {
        await apiCreateTest(testData);
        await invalidateQueries.testCreated(queryClient);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to create test";
        toast.error(msg);
        setIsPublishing(false);
        return;
      }
    } else {
      save(testData);
    }
    toast.success(status === "published" ? `Published “${title}”` : `Saved “${title}” as draft`, { description: status === "published" ? `Now visible to students in ${room?.name}` : undefined });
    navigate({ to: "/teacher/tests" });
  };

  return (
    <>
      <PageHeader eyebrow="Assessment" title="Create a test" />
      <ol className="mb-8 flex flex-wrap gap-2" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={cn("flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors", i === step ? "border-foreground text-foreground" : i < step ? "border-border text-foreground" : "border-border text-muted-foreground")}>
            <span className={cn("flex size-5 items-center justify-center rounded-full text-xs", i < step ? "bg-foreground text-background" : "border border-current")}>{i < step ? <Check className="size-3" aria-hidden="true" /> : i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Section title="Choose a classroom">
          <div role="radiogroup" aria-label="Classroom" className="grid gap-3 md:grid-cols-3">
            {classes.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={cls === c.id} onClick={() => setCls(c.id)} className={cn("ink-card ink-hover p-4 text-left", cls === c.id && "border-foreground")}>
                <p className="font-display text-lg">{c.name}</p><p className="text-sm text-muted-foreground">{c.studentIds.length} students</p>
              </button>
            ))}
          </div>
        </Section>
      )}

      {step === 1 && room && (
        <Section title={`Concepts in ${room.name}`}>
          {availableConcepts.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No concepts found in {room.name} yet. Upload notes to extract concepts automatically.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Concepts">
              {availableConcepts.map((c) => {
                const on = picked.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPicked(on ? picked.filter((x) => x !== c.id) : [...picked, c.id])}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition-all hover:-translate-y-px",
                      on ? "border-foreground bg-foreground text-background" : "border-border"
                    )}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}
        </Section>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {qs.map((q, i) => (
            <fieldset key={q.id} className="ink-card space-y-3 p-5">
              <legend className="sr-only">Question {i + 1}</legend>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Question {i + 1} · {q.type === "mcq" ? "Multiple choice" : "Short answer"}</p>
                <Button variant="ghost" size="icon" aria-label={`Remove question ${i + 1}`} onClick={() => setQs(qs.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
              </div>
              <div className="space-y-1"><Label htmlFor={`p-${q.id}`}>Prompt</Label><Textarea id={`p-${q.id}`} value={q.prompt} onChange={(e) => upd(i, { prompt: e.target.value })} /></div>
              {q.type === "mcq" ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {q.options!.map((o, k) => (
                    <div key={k} className="flex items-center gap-2">
                      <input type="radio" name={`ans-${q.id}`} aria-label={`Mark option ${k + 1} correct`} checked={!!o && q.answer === o} onChange={() => upd(i, { answer: o })} className="size-4 accent-current" />
                      <Input aria-label={`Option ${k + 1}`} value={o} onChange={(e) => { const opts = [...q.options!]; const was = q.answer === o; opts[k] = e.target.value; upd(i, { options: opts, ...(was ? { answer: e.target.value } : {}) }); }} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-1"><Label htmlFor={`a-${q.id}`}>Expected answer</Label><Input id={`a-${q.id}`} value={q.answer} onChange={(e) => upd(i, { answer: e.target.value })} /></div>
              )}
              <div className="space-y-1">
                <Label htmlFor={`c-${q.id}`}>Concept</Label>
                <select id={`c-${q.id}`} value={q.conceptId} onChange={(e) => upd(i, { conceptId: e.target.value })} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {picked.map((id) => {
                    const cName = availableConcepts.find((x) => x.id === id)?.name || conceptById[id]?.name || id;
                    return <option key={id} value={id}>{cName}</option>;
                  })}
                </select>
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => addQ("mcq")}><Plus className="size-4" aria-hidden="true" /> Multiple choice</Button>
            <Button variant="outline" onClick={() => addQ("short")}><Plus className="size-4" aria-hidden="true" /> Short answer</Button>
            <Button variant="secondary" onClick={handleGenerateAI} disabled={isGenerating}>
              {isGenerating ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
              Generate with AI
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <Section title="Configure">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1 md:col-span-3">
              <Label htmlFor="tt">Title</Label>
              <Input id="tt" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Heaps Checkpoint" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="td">Duration (minutes)</Label>
              <Input id="td" type="number" min={5} value={duration} onChange={(e) => setDuration(+e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tdueat">Deadline (Date & Time)</Label>
              <Input
                id="tdueat"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => {
                  setDueAt(e.target.value);
                  if (e.target.value) {
                    const d = new Date(e.target.value);
                    if (!isNaN(d.getTime())) {
                      setDue(d.toLocaleDateString([], { month: "short", day: "numeric" }));
                    }
                  }
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tdue">Display label</Label>
              <Input id="tdue" value={due} onChange={(e) => setDue(e.target.value)} placeholder="e.g. Oct 12" />
            </div>
          </div>
        </Section>
      )}

      {step === 4 && (
        <Section title={title}>
          <p className="mb-4 text-sm text-muted-foreground">{room?.name} · {qs.length} questions · {duration} min · due {due}</p>
          <ol className="space-y-4">
            {qs.map((q, i) => (
              <li key={q.id} className="border-b border-border pb-4 last:border-0">
                <p className="font-display text-lg">{i + 1}. {q.prompt}</p>
                {q.options && <ul className="mt-2 grid gap-1 text-sm md:grid-cols-2">{q.options.map((o, k) => <li key={k} className={cn("rounded border px-3 py-1.5", o === q.answer ? "border-foreground" : "border-border text-muted-foreground")}>{o}{o === q.answer && <span className="sr-only"> (correct)</span>}</li>)}</ul>}
                {q.type === "short" && <p className="mt-1 text-sm text-muted-foreground">Expected: {q.answer}</p>}
              </li>
            ))}
          </ol>
        </Section>
      )}

      <div className="mt-6 flex justify-between gap-2">
        <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>
        {step < 4 ? (
          <Button disabled={!canNext} onClick={() => { if (step === 1 && qs.length === 0) addQ("mcq"); setStep(step + 1); }}>Continue</Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" disabled={isPublishing} onClick={() => publish("draft")}>
              {isPublishing ? "Saving..." : "Save draft"}
            </Button>
            <Button disabled={isPublishing} onClick={() => publish("published")}>
              {isPublishing ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Publishing...
                </>
              ) : (
                "Publish test"
              )}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
