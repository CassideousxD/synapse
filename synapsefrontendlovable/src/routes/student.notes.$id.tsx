import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { meta } from "@/lib/meta";
import { ConceptChip, MasteryBar } from "@/components/synapse/ui";
import { useNote, useNotes, useMastery, useClassroom } from "@/services/synapse";
import { concepts as demoConcepts } from "@/demo/concepts";
import { MarkdownContent } from "@/components/synapse/MarkdownContent";

export const Route = createFileRoute("/student/notes/$id")({
  validateSearch: z.object({ section: z.string().optional() }),
  head: () => meta("Reading", "Interactive class notes with linked concepts."),
  component: Reader,
});

function Reader() {
  const { id } = Route.useParams();
  const { section } = Route.useSearch();
  const { note, isLoading } = useNote(id);
  const all = useNotes();
  const mastery = useMastery();
  const { classroom: cls } = useClassroom(note?.classroomId ?? "");

  const conceptMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (Array.isArray(demoConcepts)) {
      demoConcepts.forEach((c) => {
        if (c?.name && c?.id) map[c.name] = c.id;
      });
    }
    if (Array.isArray(mastery)) {
      mastery.forEach((m) => {
        if (m?.name && m?.id) map[m.name] = m.id;
      });
    }
    return map;
  }, [mastery]);

  useEffect(() => {
    if (section) document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [section]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Loading note…</p>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="mx-auto max-w-6xl py-12">
        <h2 className="text-2xl font-display">Note not found</h2>
        <p className="mt-2 text-muted-foreground">
          This note may not be published yet, or you may not be enrolled in its classroom.
        </p>
        <p className="mt-4">
          <Link to="/student/classrooms" className="text-sm underline underline-offset-4 text-primary">
            ← Back to my classes
          </Link>
        </p>
      </div>
    );
  }

  const conceptIds = Array.isArray(note.conceptIds) ? note.conceptIds : [];
  const sections = Array.isArray(note.sections) ? note.sections : [];

  const related = (all || [])
    .filter((n) => n && n.id !== note.id && n.published && Array.isArray(n.conceptIds) && n.conceptIds.some((c) => conceptIds.includes(c)))
    .slice(0, 3);

  return (
    <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1fr_16rem]">
      <article className="max-w-[68ch]">
        <p className="mb-4 text-sm">
          <Link to="/student/classrooms/$id" params={{ id: note.classroomId }} className="text-muted-foreground hover:text-foreground">
            ← {cls?.name}
          </Link>
        </p>
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Notes · updated {note.updated || "Recently"}</p>
        <h1 className="mt-2 text-4xl md:text-5xl">{note.title}</h1>
        {note.summary && (
          <p className="mt-4 font-display text-xl italic text-muted-foreground">{note.summary}</p>
        )}

        {sections.length > 0 ? (
          sections.map((s) => (
            <section
              key={s.id}
              id={s.id}
              className={`mt-10 scroll-mt-8 ${section === s.id ? "border-l-2 border-foreground pl-4" : ""}`}
            >
              <h2 className="text-2xl font-medium tracking-tight">{s.heading}</h2>
              <div className="mt-3 text-lg leading-8 text-foreground/90">
                <MarkdownContent content={s.body} conceptMap={conceptMap} />
              </div>
            </section>
          ))
        ) : (
          <div className="mt-8 text-lg leading-8 text-foreground/90">
            <MarkdownContent content={note.content || note.summary || "No content available."} conceptMap={conceptMap} />
          </div>
        )}
      </article>

      <aside className="space-y-8 lg:sticky lg:top-10 lg:self-start" aria-label="Note context">
        {sections.length > 0 && (
          <nav aria-label="On this page">
            <p className="mb-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">Contents</p>
            <ul className="space-y-1 text-sm">
              {sections.map((s) => (
                <li key={s.id}>
                  <Link
                    to="/student/notes/$id"
                    params={{ id: note.id }}
                    search={{ section: s.id }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {s.heading}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">Your mastery</p>
          <ul className="space-y-2">
            {(mastery || [])
              .filter((m) => conceptIds.includes(m.id))
              .map((m) => (
                <li key={m.id}>
                  <p className="text-sm">{m.name}</p>
                  <MasteryBar value={m.mastery} label={m.name} />
                </li>
              ))}
          </ul>
        </div>

        {note.status === "PROCESSING" ? (
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">Concepts</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin text-primary" />
              <span>Concepts are being prepared…</span>
            </div>
          </div>
        ) : conceptIds.length > 0 ? (
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">Concepts</p>
            <div className="flex flex-wrap gap-1.5">
              {conceptIds.map((c) => (
                <ConceptChip key={c} id={c} />
              ))}
            </div>
          </div>
        ) : null}

        {related.length > 0 && (
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">Related notes</p>
            <ul className="space-y-1 text-sm">
              {related.map((r) => (
                <li key={r.id}>
                  <Link to="/student/notes/$id" params={{ id: r.id }} className="hover:underline">
                    {r.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
