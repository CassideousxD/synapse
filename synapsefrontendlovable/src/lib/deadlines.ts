export interface DeadlineInfo {
  label: string;
  isOverdue: boolean;
  formatted: string;
}

export function formatDeadline(due?: string, dueAt?: string): DeadlineInfo {
  if (!dueAt) {
    const isOverdue = due?.toLowerCase().includes("overdue") ?? false;
    return {
      label: due || "Upcoming",
      isOverdue,
      formatted: due ? `Due ${due}` : "Upcoming",
    };
  }

  const dueDate = new Date(dueAt);
  if (isNaN(dueDate.getTime())) {
    return {
      label: due || "Upcoming",
      isOverdue: false,
      formatted: due ? `Due ${due}` : "Upcoming",
    };
  }

  const now = new Date();
  const diffMs = dueDate.getTime() - now.getTime();

  if (diffMs < 0) {
    return {
      label: "Overdue",
      isOverdue: true,
      formatted: "Overdue",
    };
  }

  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 60) {
    return {
      label: `Due in ${Math.max(1, diffMins)}m`,
      isOverdue: false,
      formatted: `Due in ${Math.max(1, diffMins)}m`,
    };
  }

  if (diffHours < 24) {
    const remainMins = diffMins % 60;
    return {
      label: `Due in ${diffHours}h ${remainMins}m`,
      isOverdue: false,
      formatted: `Due in ${diffHours}h ${remainMins}m`,
    };
  }

  // Same calendar day tomorrow check
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    tomorrow.getDate() === dueDate.getDate() &&
    tomorrow.getMonth() === dueDate.getMonth() &&
    tomorrow.getFullYear() === dueDate.getFullYear();

  const timeStr = dueDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (isTomorrow) {
    return {
      label: `Due tomorrow · ${timeStr}`,
      isOverdue: false,
      formatted: `Due tomorrow · ${timeStr}`,
    };
  }

  const dateStr = dueDate.toLocaleDateString([], { month: "short", day: "numeric" });
  return {
    label: `Due ${dateStr} · ${timeStr}`,
    isOverdue: false,
    formatted: `Due ${dateStr} · ${timeStr}`,
  };
}

export function formatTimeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "Recently";

  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
