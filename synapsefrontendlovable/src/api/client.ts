/**
 * Centralized API client for Synapse backend.
 * Handles base URL, auth headers, token lifecycle, and error wrapping.
 */

export const API_BASE_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.["VITE_API_BASE_URL"]) ||
  "http://localhost:8000";

const TOKEN_KEY = "synapse_auth_token";

export type AuthRole = "teacher" | "student";

let inMemoryTokens: Record<string, string | null> = {
  teacher: null,
  student: null,
  default: null,
};

let activeAppRole: AuthRole | null = null;

export function setActiveRole(role: AuthRole | null): void {
  activeAppRole = role;
}

export function getActiveRole(): AuthRole | null {
  return activeAppRole;
}

export function getRoleToken(role: AuthRole): string | null {
  if (inMemoryTokens[role]) return inMemoryTokens[role];
  if (typeof window !== "undefined") {
    try {
      const key = `${TOKEN_KEY}_${role}`;
      const sessionStored = window.sessionStorage?.getItem(key);
      if (sessionStored) {
        inMemoryTokens[role] = sessionStored;
        return sessionStored;
      }
      const localStored = window.localStorage?.getItem(key);
      if (localStored) {
        inMemoryTokens[role] = localStored;
        return localStored;
      }
    } catch {
      // Storage access blocked
    }
  }
  return null;
}

export function setRoleToken(role: AuthRole, token: string | null, remember: boolean = false): void {
  inMemoryTokens[role] = token;
  if (typeof window !== "undefined") {
    const key = `${TOKEN_KEY}_${role}`;
    try {
      if (token) {
        if (remember) {
          window.localStorage?.setItem(key, token);
          window.sessionStorage?.removeItem(key);
        } else {
          window.sessionStorage?.setItem(key, token);
          window.localStorage?.removeItem(key);
        }
      } else {
        window.sessionStorage?.removeItem(key);
        window.localStorage?.removeItem(key);
      }
    } catch {
      // Storage access blocked
    }
  }
}

export function getRoleUser<T = any>(role: AuthRole): T | null {
  if (typeof window !== "undefined") {
    try {
      const key = `synapse_user_${role}`;
      const raw = window.localStorage?.getItem(key) || window.sessionStorage?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function setRoleUser(role: AuthRole, user: any, remember: boolean = false): void {
  if (typeof window !== "undefined") {
    const key = `synapse_user_${role}`;
    try {
      if (user) {
        const val = JSON.stringify(user);
        if (remember) {
          window.localStorage?.setItem(key, val);
          window.sessionStorage?.removeItem(key);
        } else {
          window.sessionStorage?.setItem(key, val);
          window.localStorage?.removeItem(key);
        }
      } else {
        window.localStorage?.removeItem(key);
        window.sessionStorage?.removeItem(key);
      }
    } catch {
      // Storage access blocked
    }
  }
}

export function clearRoleSession(role: AuthRole): void {
  setRoleToken(role, null);
  setRoleUser(role, null);
  if (activeAppRole === role) {
    activeAppRole = null;
  }
}

export function getToken(): string | null {
  // If an active role is set, use its token
  if (activeAppRole) {
    const tok = getRoleToken(activeAppRole);
    if (tok) return tok;
  }

  // Fallback to checking role-scoped tokens, then legacy global token
  const teacherTok = getRoleToken("teacher");
  if (teacherTok) return teacherTok;

  const studentTok = getRoleToken("student");
  if (studentTok) return studentTok;

  if (typeof window !== "undefined") {
    try {
      return window.sessionStorage?.getItem(TOKEN_KEY) || window.localStorage?.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }
  return null;
}

export function setToken(token: string | null, remember: boolean = false): void {
  if (activeAppRole) {
    setRoleToken(activeAppRole, token, remember);
  }
  if (typeof window !== "undefined") {
    try {
      if (token) {
        if (remember) {
          window.localStorage?.setItem(TOKEN_KEY, token);
          window.sessionStorage?.removeItem(TOKEN_KEY);
        } else {
          window.sessionStorage?.setItem(TOKEN_KEY, token);
          window.localStorage?.removeItem(TOKEN_KEY);
        }
      } else {
        window.sessionStorage?.removeItem(TOKEN_KEY);
        window.localStorage?.removeItem(TOKEN_KEY);
      }
    } catch {}
  }
}

export function getRememberedEmail(role?: AuthRole): string {
  if (typeof window === "undefined") return "";
  try {
    if (role) {
      return window.localStorage?.getItem(`synapse_remembered_email_${role}`) || "";
    }
    return (
      window.localStorage?.getItem("synapse_remembered_email_student") ||
      window.localStorage?.getItem("synapse_remembered_email_teacher") ||
      window.localStorage?.getItem("synapse_remembered_email") ||
      ""
    );
  } catch {
    return "";
  }
}

export function isRememberMeEnabled(role?: AuthRole): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (role) {
      return window.localStorage?.getItem(`synapse_remember_me_${role}`) === "true";
    }
    return window.localStorage?.getItem("synapse_remember_me_flag") === "true";
  } catch {
    return false;
  }
}

export function saveRememberMe(role: AuthRole | string, email: string, remember: boolean): void {
  if (typeof window === "undefined") return;
  try {
    const emailKey = `synapse_remembered_email_${role}`;
    const flagKey = `synapse_remember_me_${role}`;
    if (remember && email.trim()) {
      window.localStorage?.setItem(emailKey, email.trim());
      window.localStorage?.setItem(flagKey, "true");
      // Also update generic keys for compatibility
      window.localStorage?.setItem("synapse_remembered_email", email.trim());
      window.localStorage?.setItem("synapse_remember_me_flag", "true");
    } else {
      window.localStorage?.removeItem(emailKey);
      window.localStorage?.removeItem(flagKey);
    }
  } catch {}
}

export function clearToken(): void {
  if (activeAppRole) {
    clearRoleSession(activeAppRole);
  }
  setToken(null, false);
}

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export interface ApiFetchOptions extends RequestInit {
  requiresAuth?: boolean;
}

export async function apiFetch<T>(
  endpoint: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { requiresAuth = true, headers, ...rest } = options;

  const url = endpoint.startsWith("http")
    ? endpoint
    : `${API_BASE_URL}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

  const requestHeaders = new Headers(headers);

  if (!requestHeaders.has("Content-Type") && !(rest.body instanceof FormData)) {
    requestHeaders.set("Content-Type", "application/json");
  }

  if (requiresAuth) {
    const token = getToken();
    if (token && !requestHeaders.has("Authorization")) {
      requestHeaders.set("Authorization", `Bearer ${token}`);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers: requestHeaders,
    });
  } catch (err) {
    throw new ApiError(0, "Network connection error. Is the backend running?", err);
  }

  if (!response.ok) {
    let errorDetail = `Request failed with status ${response.status}`;
    let errorData: unknown = null;
    try {
      errorData = await response.json();
      if (errorData && typeof errorData === "object" && "detail" in errorData) {
        errorDetail = String((errorData as { detail: unknown }).detail);
      }
    } catch {
      try {
        errorDetail = await response.text();
      } catch {
        // Ignored
      }
    }

    if (response.status === 401) {
      clearToken();
    }

    throw new ApiError(response.status, errorDetail, errorData);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return (await response.json()) as T;
}
