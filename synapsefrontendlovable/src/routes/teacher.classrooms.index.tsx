import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Plus, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { meta } from "@/lib/meta";
import { PageHeader, MasteryBar } from "@/components/synapse/ui";
import {
  useClassrooms,
  useTests,
  useNotes,
  classAverageMastery,
  useTeacherAnalyticsDashboard,
  apiCreateClassroom,
  invalidateQueries,
} from "@/services/synapse";
import { useDemo } from "@/stores/demo-store";
import { getToken } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/teacher/classrooms/")({
  head: () => meta("Classrooms", "All of your classrooms, join codes and mastery at a glance."),
  component: Classrooms,
});

function Classrooms() {
  const classes = useClassrooms();
  const tests = useTests();
  const notes = useNotes();
  const { data: dashboard } = useTeacherAnalyticsDashboard();
  const token = getToken();

  const classroomMasteryMap = useMemo(() => {
    const map = new Map<string, number>();
    if (dashboard?.classrooms) {
      for (const c of dashboard.classrooms) {
        map.set(c.id, c.averageMastery);
      }
    }
    return map;
  }, [dashboard]);

  return (
    <>
      <PageHeader eyebrow="Teaching" title="Classrooms" actions={<NewClassroom />}>Every class you teach, with its join code and current standing.</PageHeader>
      {classes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <h3 className="font-display text-lg">No classrooms yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first classroom to get a join code and invite students.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {classes.map((c) => (
            <li key={c.id}>
              <Link to="/teacher/classrooms/$id" params={{ id: c.id }} className="ink-card ink-hover flex h-full flex-col p-5">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{c.subject}</p>
                <h2 className="mt-2 text-2xl">{c.name}</h2>
                <p className="mt-2 flex-1 text-sm text-muted-foreground">{c.description}</p>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-muted-foreground">Students</dt><dd>{c.studentIds.length}</dd></div>
                  <div><dt className="text-muted-foreground">Tests</dt><dd>{tests.filter((t) => t.classroomId === c.id).length}</dd></div>
                  <div><dt className="text-muted-foreground">Notes</dt><dd>{notes.filter((n) => n.classroomId === c.id).length}</dd></div>
                </dl>
                <div className="mt-4">
                  <MasteryBar
                    value={
                      token && dashboard
                        ? (classroomMasteryMap.get(c.id) ?? null)
                        : (c.studentIds.length ? classAverageMastery(c.studentIds) : null)
                    }
                    label={c.name}
                  />
                </div>
                <p className="mt-3 text-sm">Join code <span className="font-mono tracking-widest">{c.joinCode}</span></p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function NewClassroom() {
  const queryClient = useQueryClient();
  const createDemo = useDemo((s) => s.createClassroom);
  const [open, setOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("Computer Science");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isCreating) return;
    setIsCreating(true);
    let c;
    try {
      const token = getToken();
      if (token) {
        c = await apiCreateClassroom({ name: name.trim(), subject });
        await invalidateQueries.classroomCreated(queryClient);
      } else {
        c = createDemo(name.trim(), subject);
      }
      toast.success(`Created ${c.name}`, { description: `Join code ${c.joinCode}` });
      setOpen(false);
      setName("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create classroom";
      toast.error(msg);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="size-4" aria-hidden="true" /> New classroom</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-normal">New classroom</DialogTitle>
            <DialogDescription>Students will join with a generated six-character code.</DialogDescription>
          </DialogHeader>
          <div className="my-6 space-y-4">
            <div className="space-y-2"><Label htmlFor="cname">Name</Label><Input id="cname" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Operating Systems" /></div>
            <div className="space-y-2"><Label htmlFor="csub">Subject</Label><Input id="csub" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create classroom"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
