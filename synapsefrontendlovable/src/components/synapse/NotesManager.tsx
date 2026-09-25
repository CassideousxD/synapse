import { useRef, useState } from "react";
import { Upload, Plus, Trash2, Loader2, AlertTriangle, BookOpen } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDemo } from "@/stores/demo-store";
import { getToken } from "@/api/client";
import {
  useNotes,
  useClassrooms,
  apiCreateNote,
  apiUpdateNote,
  apiDeleteNote,
  apiRetryNote,
  invalidateQueries,
} from "@/services/synapse";
import { concepts } from "@/demo/concepts";
import { ConceptChip, Empty } from "./ui";
import { MarkdownContent } from "./MarkdownContent";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Note } from "@/demo/data";

/** Naive local "concept extraction": match concept names in the text. */
function extract(text: string) {
  const t = text.toLowerCase();
  return concepts.filter((c) => t.includes(c.name.toLowerCase()) || t.includes(c.id.replace(/-/g, " "))).map((c) => c.id).slice(0, 6);
}

export function NotesManager({ classroomId }: { classroomId?: string }) {
  const queryClient = useQueryClient();
  const notes = useNotes(classroomId);
  const classes = useClassrooms();
  const toggle = useDemo((s) => s.toggleNote);
  const add = useDemo((s) => s.addNote);
  const removeDemoNote = useDemo((s) => s.deleteNote);
  const [open, setOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [cls, setCls] = useState(classroomId ?? classes[0]?.id ?? "dsa");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadContent, setUploadContent] = useState("");
  const [uploadCls, setUploadCls] = useState(classroomId ?? classes[0]?.id ?? "");
  const [uploadPublishNow, setUploadPublishNow] = useState(true);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [deletingNote, setDeletingNote] = useState<Note | null>(null);
  const [viewingNote, setViewingNote] = useState<Note | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [publishNow, setPublishNow] = useState(true);

  const create = async (t: string, b: string, classId: string, publishImmediately: boolean = true) => {
    const token = getToken();
    if (token) {
      try {
        const created = await apiCreateNote({
          title: t,
          classroomId: classId,
          content: b,
          published: publishImmediately,
          summary: b.slice(0, 140),
        });
        await invalidateQueries.noteSaved(queryClient);
        const count = created.conceptIds?.length || 0;
        toast.success(publishImmediately ? `“${t}” published` : `“${t}” added as draft`, {
          description: created.status === "PROCESSING" ? "AI extracting concepts in background…" : count ? `${count} concept${count > 1 ? "s" : ""} extracted` : "Note saved",
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to create note";
        toast.error(msg);
        return;
      }
    } else {
      const ids = extract(`${t} ${b}`);
      const newNote = {
        id: `${t.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`,
        title: t,
        classroomId: classId,
        conceptIds: ids,
        published: publishImmediately,
        status: "READY" as const,
        updated: "Today",
        summary: b.slice(0, 140) || "",
        content: b,
        sections: [{ id: "s1", heading: "Overview", body: b, conceptId: ids[0] }],
      };
      add(newNote);
      toast(publishImmediately ? `“${t}” published` : `“${t}” added as draft`, {
        description: ids.length ? `${ids.length} concepts extracted` : "No concepts detected yet",
      });
    }
  };

  const handleRetry = async (noteId: string) => {
    const token = getToken();
    if (token) {
      try {
        await apiRetryNote(noteId);
        await queryClient.invalidateQueries({ queryKey: ["notes"] });
        toast.info("Retrying concept extraction...");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Retry failed";
        toast.error(msg);
      }
    }
  };

  const handleToggle = async (noteId: string, currentPublished: boolean) => {
    const token = getToken();
    if (token) {
      try {
        await apiUpdateNote(noteId, { published: !currentPublished });
        await invalidateQueries.notePublishedToggled(queryClient);
        toast.success(!currentPublished ? "Note published" : "Note unpublished");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to update note status";
        toast.error(msg);
      }
    } else {
      toggle(noteId);
      toast(!currentPublished ? "Note published" : "Note unpublished");
    }
  };

  const handleDelete = async (note: Note) => {
    const token = getToken();
    if (token) {
      setIsDeleting(true);
      try {
        await apiDeleteNote(note.id, note.classroomId);
        await invalidateQueries.noteDeleted(queryClient, note.id, note.classroomId);
        toast.success(`“${note.title}” deleted`);
        setDeletingNote(null);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to delete note";
        toast.error(msg);
      } finally {
        setIsDeleting(false);
      }
    } else {
      removeDemoNote(note.id);
      toast.success(`“${note.title}” deleted`);
      setDeletingNote(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden="true" /> Create note</Button>
        <Button variant="outline" onClick={() => {
          setUploadCls(classroomId ?? classes[0]?.id ?? "");
          setUploadOpen(true);
        }}>
          <Upload className="size-4" aria-hidden="true" /> Upload file
        </Button>
      </div>
      {notes.length === 0 ? <Empty>No notes yet — create or upload your first one.</Empty> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {notes.map((n) => (
            <li key={n.id} className="ink-card ink-hover p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg">{n.title}</h3>
                    {n.status === "PROCESSING" && (
                      <span
                        className="inline-flex items-center text-muted-foreground"
                        title="Processing note... AI concept extraction in progress"
                        aria-label="Processing note..."
                      >
                        <Loader2 className="size-3.5 animate-spin text-primary" />
                      </span>
                    )}
                    {n.status === "FAILED" && (
                      <span
                        className="inline-flex items-center text-amber-500"
                        title="Processing failed"
                        aria-label="Processing failed"
                      >
                        <AlertTriangle className="size-3.5" />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{classes.find((c) => c.id === n.classroomId)?.name} · Updated {n.updated}</p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    {n.published ? "Published" : "Draft"}
                    <Switch checked={n.published} onCheckedChange={() => handleToggle(n.id, n.published)} aria-label={`${n.published ? "Unpublish" : "Publish"} ${n.title}`} />
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => setViewingNote(n)}
                    aria-label={`Read ${n.title}`}
                    title="Read full note"
                  >
                    <BookOpen className="size-3.5" aria-hidden="true" />
                    <span>Read</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setDeletingNote(n)}
                    aria-label={`Delete ${n.title}`}
                    title="Delete note"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{n.summary}</p>
              <p className="mt-3 text-xs uppercase tracking-[0.12em] text-muted-foreground">Extracted concepts</p>
              {n.status === "PROCESSING" ? (
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin text-primary" />
                  <span>Extracting concepts…</span>
                </div>
              ) : n.status === "FAILED" ? (
                <div className="mt-1 flex items-center gap-2 text-xs text-amber-500">
                  <AlertTriangle className="size-3" />
                  <span>Processing failed</span>
                  <button
                    type="button"
                    onClick={() => handleRetry(n.id)}
                    className="underline underline-offset-2 hover:text-amber-400 font-medium"
                    title="Retry AI concept extraction"
                  >
                    Retry
                  </button>
                </div>
              ) : (n.conceptIds || []).length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">No concepts extracted.</p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {(n.conceptIds || []).map((id) => (
                    <ConceptChip key={id} id={id} to="none" />
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={!!deletingNote} onOpenChange={(open) => !open && setDeletingNote(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <span className="font-medium text-foreground">“{deletingNote?.title}”</span>? This will remove the note from the classroom and reconcile derived curriculum concepts. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                if (deletingNote) handleDelete(deletingNote);
              }}
            >
              {isDeleting ? "Deleting..." : "Delete note"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!viewingNote} onOpenChange={(open) => !open && setViewingNote(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                {classes.find((c) => c.id === viewingNote?.classroomId)?.name || "Classroom Note"}
              </span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">Updated {viewingNote?.updated}</span>
            </div>
            <DialogTitle className="font-display text-2xl font-normal mt-1">
              {viewingNote?.title}
            </DialogTitle>
            {viewingNote?.summary && (
              <DialogDescription className="text-sm text-muted-foreground mt-1">
                {viewingNote.summary}
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="flex-1 overflow-y-auto pr-1 space-y-6 my-2 text-sm leading-relaxed">
            {viewingNote?.sections && viewingNote.sections.length > 0 ? (
              viewingNote.sections.map((section, idx) => (
                <div key={section.id || idx} className="space-y-2 border-b border-border/40 pb-5 last:border-b-0">
                  {section.heading && (
                    <h3 className="font-medium text-base text-foreground tracking-tight">
                      {section.heading}
                    </h3>
                  )}
                  <MarkdownContent content={section.body} />
                </div>
              ))
            ) : viewingNote?.content ? (
              <MarkdownContent content={viewingNote.content} />
            ) : (
              <p className="text-muted-foreground italic">No content available for this note.</p>
            )}
          </div>

          <DialogFooter className="border-t pt-3 flex items-center justify-between sm:justify-between">
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-muted-foreground mr-1">Concepts:</span>
              {(viewingNote?.conceptIds || []).length > 0 ? (
                viewingNote?.conceptIds.map((id) => <ConceptChip key={id} id={id} to="none" />)
              ) : (
                <span className="text-xs text-muted-foreground italic">None</span>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => setViewingNote(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            const targetCls = cls || classroomId || classes[0]?.id;
            if (!targetCls) {
              toast.error("Please create a classroom first.");
              return;
            }
            create(title.trim(), body, targetCls, publishNow);
            setOpen(false);
            setTitle("");
            setBody("");
            setPublishNow(true);
          }}>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl font-normal">Create note</DialogTitle>
              <DialogDescription>Concepts mentioned in the text are extracted automatically.</DialogDescription>
            </DialogHeader>
            <div className="my-5 space-y-4">
              {!classroomId && (
                <div className="space-y-2">
                  <Label htmlFor="ncls">Classroom</Label>
                  {classes.length === 0 ? (
                    <p className="text-xs text-destructive">No classrooms found. Please create a classroom first.</p>
                  ) : (
                    <Select value={cls || classes[0]?.id} onValueChange={setCls}>
                      <SelectTrigger id="ncls"><SelectValue placeholder="Select a classroom" /></SelectTrigger>
                      <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>
              )}
              <div className="space-y-2"><Label htmlFor="ntitle">Title</Label><Input id="ntitle" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Heaps and Priority Queues" /></div>
              <div className="space-y-2"><Label htmlFor="nbody">Content</Label><Textarea id="nbody" rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="A heap is a complete binary tree…" /></div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="publish-toggle" className="text-sm font-medium">Publish immediately</Label>
                  <p className="text-xs text-muted-foreground">Make this note visible to enrolled students right away.</p>
                </div>
                <Switch id="publish-toggle" checked={publishNow} onCheckedChange={setPublishNow} />
              </div>
              {extract(`${title} ${body}`).length > 0 && (
                <div aria-live="polite"><p className="text-xs text-muted-foreground">Detected concepts</p><div className="mt-1 flex flex-wrap gap-1.5">{extract(`${title} ${body}`).map((id) => <ConceptChip key={id} id={id} to="none" />)}</div></div>
              )}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!classroomId && classes.length === 0}>
                {publishNow ? "Publish note" : "Save as draft"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={(e) => {
            e.preventDefault();
            const targetCls = uploadCls || classroomId || classes[0]?.id;
            if (!targetCls) {
              toast.error("Please select a target classroom.");
              return;
            }
            if (!uploadTitle.trim()) {
              toast.error("Please provide a note title.");
              return;
            }
            if (!uploadContent.trim()) {
              toast.error("File content is empty or unreadable.");
              return;
            }
            create(uploadTitle.trim(), uploadContent, targetCls, uploadPublishNow);
            setUploadOpen(false);
            setUploadTitle("");
            setUploadContent("");
            setUploadedFileName("");
            setUploadPublishNow(true);
          }}>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl font-normal">Upload note document</DialogTitle>
              <DialogDescription>
                Select a target classroom and upload a Markdown or text file. Concepts are extracted automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="my-5 space-y-4">
              {!classroomId && (
                <div className="space-y-2">
                  <Label htmlFor="ucls">Target Classroom (Required)</Label>
                  {classes.length === 0 ? (
                    <p className="text-xs text-destructive">No classrooms found. Please create a classroom first.</p>
                  ) : (
                    <Select value={uploadCls || classes[0]?.id} onValueChange={setUploadCls}>
                      <SelectTrigger id="ucls"><SelectValue placeholder="Select a classroom" /></SelectTrigger>
                      <SelectContent>
                        {classes.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="ufile">Select Document (.md, .txt, .markdown)</Label>
                <Input
                  id="ufile"
                  type="file"
                  accept=".txt,.md,.markdown"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setIsReadingFile(true);
                    try {
                      const text = await f.text();
                      if (!text.trim()) {
                        toast.error("File appears to be empty.");
                        return;
                      }
                      setUploadContent(text);
                      setUploadedFileName(f.name);
                      const rawTitle = f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
                      setUploadTitle(rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1));
                    } catch {
                      toast.error("Failed to read file contents.");
                    } finally {
                      setIsReadingFile(false);
                    }
                  }}
                />
                {uploadedFileName && (
                  <p className="text-xs text-muted-foreground font-mono">
                    Loaded: {uploadedFileName} ({Math.round(uploadContent.length / 1024 * 10) / 10} KB)
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="utitle">Note Title</Label>
                <Input
                  id="utitle"
                  required
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="e.g. Heaps and Priority Queues"
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="upload-publish-toggle" className="text-sm font-medium">Publish immediately</Label>
                  <p className="text-xs text-muted-foreground">Make this note visible to enrolled students right away.</p>
                </div>
                <Switch id="upload-publish-toggle" checked={uploadPublishNow} onCheckedChange={setUploadPublishNow} />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={
                  (!classroomId && classes.length === 0) ||
                  !uploadContent.trim() ||
                  !uploadTitle.trim() ||
                  isReadingFile
                }
              >
                Upload & process note
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
