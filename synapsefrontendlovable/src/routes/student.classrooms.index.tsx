import { createFileRoute, Link } from "@tanstack/react-router";
import { meta } from "@/lib/meta";
import { PageHeader } from "@/components/synapse/ui";
import { JoinClass } from "@/components/synapse/JoinClass";
import { useStudentClassrooms, useNotes, useStudentTests } from "@/services/synapse";

export const Route = createFileRoute("/student/classrooms/")({
  head: () => meta("My classes", "Classes you're enrolled in and a place to join new ones."),
  component: MyClasses,
});

function MyClasses() {
  const classes = useStudentClassrooms();
  const notes = useNotes();
  const { upcoming } = useStudentTests();
  return (
    <>
      <PageHeader eyebrow="Learning" title="My classes">Each class has its own notes, tests and concept map.</PageHeader>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {classes.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center md:col-span-2">
            <h3 className="font-display text-lg">No classes enrolled yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter a 6-character classroom join code to access notes, tests, and your learning graph.
            </p>
          </div>
        )}
        {classes.map((c) => (
          <Link key={c.id} to="/student/classrooms/$id" params={{ id: c.id }} className="ink-card ink-hover flex flex-col p-5">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{c.subject}</p>
            <h2 className="mt-2 text-2xl">{c.name}</h2>
            <p className="text-sm text-muted-foreground">{c.description || c.subject}</p>
            <p className="mt-4 text-sm">{notes.filter((n) => n.classroomId === c.id && n.published).length} notes · {upcoming.filter((t) => t.classroomId === c.id).length} upcoming tests</p>
            <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">Enrolled</p>
          </Link>
        ))}
        <JoinClass />
      </div>
    </>
  );
}
