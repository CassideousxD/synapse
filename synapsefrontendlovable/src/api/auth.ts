/**
 * Authentication API module for Synapse.
 * Supports teacher & student registration, login, profile check, and logout.
 */

import { apiFetch, clearToken, setToken } from "./client";

export type Role = "teacher" | "student";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface AuthResponse {
  accessToken: string;
  tokenType: string;
  user?: User;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface LoginPayload {
  email?: string;
  username?: string;
  password: string;
  rememberMe?: boolean;
}

export async function registerTeacher(payload: RegisterPayload): Promise<AuthResponse> {
  const res = await apiFetch<AuthResponse>("/auth/register/teacher", {
    method: "POST",
    body: JSON.stringify(payload),
    requiresAuth: false,
  });
  if (res.accessToken) {
    setToken(res.accessToken, Boolean(payload.rememberMe));
  }
  return res;
}

export async function registerStudent(payload: RegisterPayload): Promise<AuthResponse> {
  const res = await apiFetch<AuthResponse>("/auth/register/student", {
    method: "POST",
    body: JSON.stringify(payload),
    requiresAuth: false,
  });
  if (res.accessToken) {
    setToken(res.accessToken, Boolean(payload.rememberMe));
  }
  return res;
}

export async function login(payload: LoginPayload): Promise<AuthResponse> {
  const res = await apiFetch<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
    requiresAuth: false,
  });
  if (res.accessToken) {
    setToken(res.accessToken, Boolean(payload.rememberMe));
  }
  return res;
}

export async function getMe(): Promise<User> {
  return apiFetch<User>("/auth/me", {
    method: "GET",
    requiresAuth: true,
  });
}

export function logout(): void {
  clearToken();
}
