import { apiFetch } from "./client";
import type { NotificationItem } from "@/demo/data";

export async function getNotifications(): Promise<NotificationItem[]> {
  const data = await apiFetch<NotificationItem[]>("/notifications");
  return Array.isArray(data) ? data : [];
}

export async function getUnreadNotificationsCount(): Promise<number> {
  const data = await apiFetch<{ count: number }>("/notifications/unread-count");
  return data?.count || 0;
}

export async function markNotificationAsRead(id: string): Promise<NotificationItem> {
  return apiFetch<NotificationItem>(`/notifications/${encodeURIComponent(id)}/read`, {
    method: "PATCH",
  });
}

export async function markAllNotificationsAsRead(): Promise<void> {
  await apiFetch<{ status: string }>("/notifications/read-all", {
    method: "POST",
  });
}
