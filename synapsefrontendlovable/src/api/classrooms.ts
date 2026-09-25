import { apiFetch } from "./client";
import type { Classroom } from "@/demo/data";

export interface CreateClassroomPayload {
  name: string;
  subject?: string;
  description?: string;
}

export interface JoinClassroomResponse {
  ok: boolean;
  classroom?: Classroom;
  reason?: string;
}

export interface EnrolledStudent {
  id: string;
  name: string;
  email: string;
  role: string;
}

export async function getClassrooms(): Promise<Classroom[]> {
  return apiFetch<Classroom[]>("/classrooms");
}

export async function getClassroom(id: string): Promise<Classroom> {
  return apiFetch<Classroom>(`/classrooms/${id}`);
}

export async function createClassroom(payload: CreateClassroomPayload): Promise<Classroom> {
  return apiFetch<Classroom>("/classrooms", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function joinClassroom(joinCode: string): Promise<JoinClassroomResponse> {
  return apiFetch<JoinClassroomResponse>("/classrooms/join", {
    method: "POST",
    body: JSON.stringify({ joinCode }),
  });
}

export async function getClassroomStudents(classroomId: string): Promise<EnrolledStudent[]> {
  return apiFetch<EnrolledStudent[]>(`/classrooms/${classroomId}/students`);
}

export async function leaveClassroom(classroomId: string): Promise<{ ok: boolean; message: string }> {
  return apiFetch<{ ok: boolean; message: string }>(`/classrooms/${classroomId}/membership`, {
    method: "DELETE",
  });
}

export interface ClassroomConcept {
  id: string;
  classroomId: string;
  name: string;
  summary: string;
  description?: string;
  classroomName?: string;
  relatedConceptIds: string[];
}

export async function getClassroomConcepts(classroomId: string): Promise<ClassroomConcept[]> {
  return apiFetch<ClassroomConcept[]>(`/classrooms/${classroomId}/concepts`);
}

export async function getStudentConcepts(): Promise<ClassroomConcept[]> {
  return apiFetch<ClassroomConcept[]>("/classrooms/enrolled/concepts");
}


