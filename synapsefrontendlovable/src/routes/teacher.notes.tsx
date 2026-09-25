import { createFileRoute } from "@tanstack/react-router";
import { meta } from "@/lib/meta";
import { PageHeader } from "@/components/synapse/ui";
import { NotesManager } from "@/components/synapse/NotesManager";

export const Route = createFileRoute("/teacher/notes")({
  head: () => meta("Notes library", "Create, upload and publish notes across your classrooms."),
  component: () => (
    <>
      <PageHeader eyebrow="Teaching" title="Notes library">Every note you have written or uploaded. Publishing makes it visible to students, and concepts are extracted automatically.</PageHeader>
      <NotesManager />
    </>
  ),
});
