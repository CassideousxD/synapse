import { useState } from "react";
import { createFileRoute, Link, useNavigate, notFound } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogOut, Loader2 } from "lucide-react";
import { meta } from "@/lib/meta";
import { PageHeader, Section, MasteryBar, ConceptChip, Empty } from "@/components/synapse/ui";
import { formatDeadline } from "@/lib/deadlines";
import { cn } from "@/lib/utils";
import {
  useClassroom,
  useNotes,
  useStudentTests,
  useMastery,
  useStudentClassrooms,
  apiLeaveClassroom,
  invalidateQueries,
} from "@/services/synapse";
import { useDemo } from "@/stores/demo-store";
import { getToken } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/student/classrooms/$id")({
  head: () => meta("Class", "Notes, tests, concepts and your personal mastery for this class."),
  component: StudentClass,
});

function StudentClass() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const { classroom: c, isLoading } = useClassroom(id);
  const enrolled = useStudentClassrooms();
  const notes = useNotes(id).filter((n) => n.published);
  const { upcoming, completed } = useStudentTests();
  const mastery = useMastery();

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-muted-foreground">Loading classroom…</p>
      </div>
    );
  }
  if (!c) throw notFound();
  if (!enrolled.some((e) => e.id === id)) {
    return <Empty>You're not enrolled in this class yet. <Link to="/student/classrooms" className="underline">Join with a code</Link>.</Empty>;
  }

  const mine = mastery.filter((m) => c.conceptIds.includes(m.id));
  const assessed = mine.filter((m) => m.mastery != null);
  const personal = assessed.length > 0 ? Math.round(assessed.reduce((a, m) => a + (m.mastery ?? 0), 0) / assessed.length) : 0;
  const revise = [...mine].filter((m) => m.mastery != null).sort((a, b) => a.mastery! - b.mastery!).slice(0, 3);
  const classUpcoming = upcoming.filter((t) => t.classroomId === id);
  const classCompleted = completed.filter((x) => x.test.classroomId === id);

  const handleConfirmLeave = async () => {
    setIsLeaving(true);
    try {
      const token = getToken();
      if (token) {
        await apiLeaveClassroom(id);
      }
      useDemo.getState().leaveClass(id);

      await invalidateQueries.classroomLeft(queryClient, id);

      toast.success(`You have left ${c.name}.`);
      setLeaveDialogOpen(false);
      navigate({ to: "/student/classrooms" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to leave classroom. Please try again.";
      toast.error(msg);
      setIsLeaving(false);
    }
  };

  return (
    <>
      <p className="mb-4 text-sm"><Link to="/student/classrooms" className="text-muted-foreground hover:text-foreground">← My classes</Link></p>
      <PageHeader
        eyebrow={c.subject}
        title={c.name}
        actions={
          <AlertDialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
              >
                <LogOut className="mr-2 size-4" />
                Leave Class
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Leave this class?</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2 text-left">
                  <span>
                    Leaving this class will remove your enrollment and clear your learning data for this class, including your mastery, test attempts, analytics, and knowledge graph concepts.
                  </span>
                  <span className="block pt-2">
                    You can join the class again later using the class code, but your previous progress will not be restored.
                  </span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="mt-4">
                <AlertDialogCancel disabled={isLeaving}>Cancel</AlertDialogCancel>
                <Button
                  variant="destructive"
                  disabled={isLeaving}
                  onClick={handleConfirmLeave}
                >
                  {isLeaving ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Leaving...
                    </>
                  ) : (
                    "Leave Class"
                  )}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        }
      >
        {c.description}
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Published notes" className="lg:col-span-2">
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes published for this class yet.</p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {notes.map((n) => (
                <li key={n.id}><Link to="/student/notes/$id" params={{ id: n.id }} className="ink-card ink-hover block h-full p-4"><h3 className="text-lg">{n.title}</h3><p className="mt-1 text-sm text-muted-foreground">{n.summary}</p></Link></li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Personal mastery">
          <p className="font-display text-5xl">{personal}%</p>
          <p className="mb-4 text-sm text-muted-foreground">across {mine.length} class concepts</p>
          {mine.length === 0 ? (
            <p className="text-sm text-muted-foreground">No concepts assigned yet.</p>
          ) : (
            <ul className="space-y-2">{mine.map((m) => <li key={m.id}><p className="text-sm">{m.name}</p><MasteryBar value={m.mastery} label={m.name} /></li>)}</ul>
          )}
        </Section>
        <Section title="Upcoming tests">
          {classUpcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming tests for this class.</p>
          ) : (
            <ul className="space-y-3">
              {classUpcoming.map((t) => {
                const deadline = formatDeadline(t.due, t.dueAt);
                return (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <div>
                      <p>{t.title}</p>
                      <p className={cn("text-sm", deadline.isOverdue ? "text-destructive font-medium" : "text-muted-foreground")}>
                        {deadline.formatted} · {t.durationMin} min
                      </p>
                    </div>
                    <Button asChild size="sm">
                      <Link to="/student/tests/$id" params={{ id: t.id }}>Start</Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
        <Section title="Completed tests">
          {classCompleted.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tests completed yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">{classCompleted.map(({ test, sub }) => <li key={test.id} className="flex justify-between"><span>{test.title}</span><span className="tabular-nums">{sub.score}%</span></li>)}</ul>
          )}
        </Section>
        <Section title="Revise next">
          {revise.length === 0 ? (
            <p className="text-sm text-muted-foreground">No revision needed yet.</p>
          ) : (
            <ul className="space-y-2">{revise.map((r) => <li key={r.id}><Link to="/student/brain" search={{ c: r.id }} className="flex justify-between rounded-md p-2 text-sm hover:bg-muted"><span>{r.name}</span><span className="tabular-nums text-muted-foreground">{r.mastery}%</span></Link></li>)}</ul>
          )}
        </Section>
        <Section title="Class concepts" className="lg:col-span-3">
          {c.conceptIds.length === 0 ? (
            <p className="text-sm text-muted-foreground">No concepts associated with this class yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">{c.conceptIds.map((cid) => <ConceptChip key={cid} id={cid} />)}</div>
          )}
        </Section>
      </div>
    </>
  );
}
