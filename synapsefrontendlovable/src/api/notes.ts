import { apiFetch } from "./client";
import type { Note } from "@/demo/data";

export interface CreateNotePayload {
  title: string;
  classroomId: string;
  content?: string;
  summary?: string;
  sections?: Array<{ id: string; heading: string; body: string; conceptId?: string | undefined }>;
  conceptIds?: string[];
  published?: boolean;
}

export function normalizeNote(raw: any): Note {
  if (!raw || typeof raw !== "object") {
    return {
      id: "",
      title: "",
      classroomId: "",
      conceptIds: [],
      published: false,
      updated: "Recently",
      summary: "",
      content: "",
      sections: [],
    };
  }
  const conceptIds: string[] = Array.isArray(raw.conceptIds)
    ? raw.conceptIds
    : Array.isArray(raw.concept_ids)
      ? raw.concept_ids
      : [];
  const sections = Array.isArray(raw.sections)
    ? raw.sections.map((s: any, idx: number) => ({
        id: String(s?.id || `s-${idx + 1}`),
        heading: String(s?.heading || "Section"),
        body: String(s?.body || ""),
        conceptId: s?.conceptId || s?.concept_id || undefined,
      }))
    : [];

  const status: "PROCESSING" | "READY" | "FAILED" =
    raw.status === "PROCESSING" || raw.status === "FAILED" ? raw.status : "READY";

  return {
    id: String(raw.id || ""),
    title: String(raw.title || "Untitled Note"),
    classroomId: String(raw.classroomId || raw.classroom_id || ""),
    conceptIds,
    published: Boolean(raw.published),
    status,
    updated: String(raw.updated || "Recently"),
    summary: String(raw.summary || ""),
    content: String(raw.content || ""),
    sections,
  };
}

export async function getNotes(classroomId?: string): Promise<Note[]> {
  const query = classroomId ? `?classroomId=${encodeURIComponent(classroomId)}` : "";
  const list = await apiFetch<Note[]>(`/notes${query}`);
  return Array.isArray(list) ? list.map(normalizeNote) : [];
}

export async function getNote(id: string): Promise<Note> {
  const note = await apiFetch<Note>(`/notes/${id}`);
  return normalizeNote(note);
}

export async function createNote(payload: CreateNotePayload): Promise<Note> {
  const note = await apiFetch<Note>("/notes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return normalizeNote(note);
}

export async function updateNote(
  id: string,
  payload: { published?: boolean; title?: string; summary?: string; content?: string },
): Promise<Note> {
  const note = await apiFetch<Note>(`/notes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return normalizeNote(note);
}

export async function deleteNote(
  id: string,
  classroomId?: string,
): Promise<{ status: string; id: string; classroomId: string; reconciledConcepts: string[] }> {
  const url = classroomId
    ? `/classrooms/${encodeURIComponent(classroomId)}/notes/${encodeURIComponent(id)}`
    : `/notes/${encodeURIComponent(id)}`;
  return apiFetch<{ status: string; id: string; classroomId: string; reconciledConcepts: string[] }>(url, {
    method: "DELETE",
  });
}

export async function retryNoteExtraction(id: string): Promise<Note> {
  const note = await apiFetch<Note>(`/notes/${encodeURIComponent(id)}/retry`, {
    method: "POST",
  });
  return normalizeNote(note);
}
