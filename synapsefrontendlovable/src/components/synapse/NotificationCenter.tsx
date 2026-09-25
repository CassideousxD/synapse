import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, FileText, ClipboardCheck, Clock, CheckCheck, Users } from "lucide-react";
import { useDemo } from "@/stores/demo-store";
import {
  useNotifications,
  useUnreadNotificationsCount,
  apiMarkNotificationAsRead,
  apiMarkAllNotificationsAsRead,
  invalidateQueries,
} from "@/services/synapse";
import { formatTimeAgo } from "@/lib/deadlines";
import type { NotificationItem } from "@/demo/data";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: notifications = [] } = useNotifications();
  const { data: unreadCount = 0 } = useUnreadNotificationsCount();

  const handleNotificationClick = async (notif: NotificationItem) => {
    if (!notif.isRead) {
      try {
        await apiMarkNotificationAsRead(notif.id);
        await invalidateQueries.notificationChanged(queryClient);
      } catch {
        // Continue navigation even if network mark fails
      }
    }
    setIsOpen(false);

    const currentRole = useDemo.getState().role;
    if (notif.relatedEntityType === "classroom" && notif.relatedEntityId) {
      if (currentRole === "teacher") {
        navigate({ to: "/teacher/classrooms/$id", params: { id: notif.relatedEntityId } });
      } else {
        navigate({ to: "/student/classrooms/$id", params: { id: notif.relatedEntityId } });
      }
    } else if (notif.relatedEntityType === "note" && notif.relatedEntityId) {
      if (currentRole === "teacher") {
        navigate({ to: "/teacher/notes" });
      } else {
        navigate({ to: "/student/notes/$id", params: { id: notif.relatedEntityId } });
      }
    } else if (notif.relatedEntityType === "test" && notif.relatedEntityId) {
      if (currentRole === "teacher") {
        navigate({ to: "/teacher/tests" });
      } else {
        navigate({ to: "/student/tests/$id", params: { id: notif.relatedEntityId } });
      }
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await apiMarkAllNotificationsAsRead();
      await invalidateQueries.notificationChanged(queryClient);
    } catch {
      // ignore
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "new_note":
        return <FileText className="size-4 text-primary shrink-0" />;
      case "new_test":
        return <ClipboardCheck className="size-4 text-primary shrink-0" />;
      case "deadline_approaching":
        return <Clock className="size-4 text-amber-500 shrink-0" />;
      case "student_joined":
        return <Users className="size-4 text-primary shrink-0" />;
      case "student_submitted":
        return <ClipboardCheck className="size-4 text-emerald-500 shrink-0" />;
      default:
        return <Bell className="size-4 text-muted-foreground shrink-0" />;
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        title={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        onClick={() => setIsOpen(true)}
        className="relative inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-all hover:-translate-y-px hover:border-border hover:text-foreground"
      >
        <Bell className="size-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground shadow-sm">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-4 border-b border-border flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <DialogTitle className="font-display text-lg">Notifications</DialogTitle>
              {unreadCount > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground font-mono">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7 gap-1 text-muted-foreground hover:text-foreground"
                onClick={handleMarkAllRead}
              >
                <CheckCheck className="size-3.5" />
                Mark all read
              </Button>
            )}
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {notifications.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <Bell className="size-8 mx-auto mb-2 opacity-30" />
                <p>No notifications yet</p>
                <p className="text-xs mt-1">
                  {useDemo.getState().role === "teacher"
                    ? "You will be notified when students join your classrooms or submit assessments."
                    : "You will be notified when your teacher uploads notes or publishes tests."}
                </p>
              </div>
            ) : (
              notifications.map((notif) => (
                <button
                  key={notif.id}
                  type="button"
                  onClick={() => handleNotificationClick(notif)}
                  className={`w-full text-left rounded-md p-3 transition-colors flex items-start gap-3 hover:bg-muted/70 ${
                    !notif.isRead ? "bg-muted/30 border-l-2 border-primary" : "opacity-80"
                  }`}
                >
                  <div className="mt-0.5">{getIcon(notif.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={`text-sm ${!notif.isRead ? "font-medium text-foreground" : "text-foreground/90"}`}>
                        {notif.title}
                      </p>
                      <span className="text-[11px] text-muted-foreground shrink-0 font-mono">
                        {formatTimeAgo(notif.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                      {notif.message}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
