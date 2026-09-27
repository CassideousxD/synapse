import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect, useState, type ComponentType } from "react";
import { LogOut, Moon, Sun, Settings } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDemo, type DemoRole } from "@/stores/demo-store";
import { clearToken, clearRoleSession, getRoleToken, getRoleUser, setActiveRole, getToken } from "@/api/client";
import { deleteAccount } from "@/api/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { NotificationCenter } from "./NotificationCenter";

export interface NavItem { to: string; label: string; icon: ComponentType<{ className?: string }>; exact?: boolean }

export function AppShell({ role, nav, person, subtitle }: { role: DemoRole; nav: NavItem[]; person: string; subtitle: string }) {
  const current = useDemo((s) => s.role);
  const setRole = useDemo((s) => s.setRole);
  const theme = useDemo((s) => s.theme);
  const toggleTheme = useDemo((s) => s.toggleTheme);
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  const currentUser = useDemo((s) => s.user);
  const displayName = currentUser?.name || person;
  const displaySubtitle = currentUser?.email || subtitle;

  // Role guard: ensure active role session is active; restore if remembered, or redirect if unauthenticated
  useEffect(() => {
    setActiveRole(role);
    const roleToken = getRoleToken(role);
    const roleUser = getRoleUser(role);

    if (roleToken && roleUser && (!currentUser || currentUser.role !== role)) {
      useDemo.getState().setUser(roleUser);
      setRole(role);
      return;
    }

    if (current === null && !roleToken) {
      navigate({ to: "/", replace: true });
    } else if (current !== null && current !== role && !roleToken) {
      navigate({ to: current === "teacher" ? "/teacher" : "/student", replace: true });
    }
  }, [current, role, currentUser, setRole, navigate]);

  const queryClient = useQueryClient();

  const isActive = (n: NavItem) => (n.exact ? path === n.to : path === n.to || path.startsWith(n.to + "/"));

  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const signOut = () => {
    clearRoleSession(role);
    clearToken();
    queryClient.clear();
    useDemo.getState().setUser(null);
    setRole(null);
    navigate({ to: "/" });
  };

  const handleDeleteAccount = async () => {
    setIsDeletingAccount(true);
    try {
      const token = getToken();
      if (token) {
        await deleteAccount();
      }
      clearRoleSession(role);
      clearToken();
      queryClient.clear();
      useDemo.getState().setUser(null);
      setRole(null);
      toast.success("Your account has been deleted");
      setShowDeleteConfirm(false);
      setShowAccountDialog(false);
      navigate({ to: "/", replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete account";
      toast.error(msg);
    } finally {
      setIsDeletingAccount(false);
    }
  };

  return (
    <div className="relative z-10 flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-foreground focus:px-4 focus:py-2 focus:text-background">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-screen w-20 shrink-0 flex-col border-r border-sidebar-border bg-sidebar/85 backdrop-blur md:flex lg:w-64" aria-label="Sidebar">
        <div className="flex items-center gap-3 px-5 py-6">
          <Logo className="size-10" />
          <div className="hidden lg:block">
            <p className="font-display text-xl leading-none">Synapse</p>
            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">{role}</p>
          </div>
        </div>
        <nav aria-label="Main" className="flex-1 px-3">
          <ul className="space-y-1">
            {nav.map((n) => {
              const active = isActive(n);
              return (
                <li key={n.to} className="relative">
                  {active && (
                    <motion.span layoutId="nav-indicator" className="absolute inset-0 rounded-md bg-sidebar-accent" transition={{ type: "spring", stiffness: 380, damping: 32 }} />
                  )}
                  {active && <motion.span layoutId="nav-bar" className="absolute left-0 top-2 bottom-2 w-0.5 rounded bg-foreground" />}
                  <Link
                    to={n.to}
                    aria-current={active ? "page" : undefined}
                    className={cn("relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:text-foreground justify-center lg:justify-start", active ? "text-foreground" : "text-muted-foreground")}
                  >
                    <n.icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="sr-only lg:not-sr-only">{n.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div
            className="hidden px-2 pb-3 lg:block cursor-pointer group"
            onClick={() => setShowAccountDialog(true)}
            role="button"
            tabIndex={0}
            title="Account settings"
          >
            <p className="text-sm group-hover:text-foreground transition-colors">{displayName}</p>
            <p className="text-xs text-muted-foreground">{displaySubtitle}</p>
          </div>
          <div className="flex flex-col gap-1 lg:flex-row">
            <NotificationCenter />
            <IconBtn label="Account settings" onClick={() => setShowAccountDialog(true)}>
              <Settings className="size-4" />
            </IconBtn>
            <IconBtn label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleTheme}>
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </IconBtn>
            <IconBtn label="Sign out and switch role" onClick={signOut}><LogOut className="size-4" /></IconBtn>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur md:hidden">
          <div className="flex items-center gap-2.5"><Logo className="size-9" /><span className="font-display text-lg">Synapse</span></div>
          <div className="flex gap-1 items-center">
            <NotificationCenter />
            <IconBtn label="Account settings" onClick={() => setShowAccountDialog(true)}>
              <Settings className="size-4" />
            </IconBtn>
            <IconBtn label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleTheme}>
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </IconBtn>
            <IconBtn label="Sign out and switch role" onClick={signOut}><LogOut className="size-4" /></IconBtn>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="flex-1 px-4 pb-28 pt-6 outline-none md:px-8 md:pb-12 md:pt-10 lg:px-12">
          <Outlet />
        </main>
      </div>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur md:hidden">
        <ul className="flex justify-around">
          {nav.slice(0, 5).map((n) => {
            const active = isActive(n);
            return (
              <li key={n.to}>
                <Link to={n.to} aria-current={active ? "page" : undefined} className={cn("flex min-h-14 min-w-14 flex-col items-center justify-center gap-1 px-2 text-[11px]", active ? "text-foreground" : "text-muted-foreground")}>
                  <n.icon className="size-5" aria-hidden="true" />
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Account Settings Dialog */}
      <Dialog open={showAccountDialog} onOpenChange={setShowAccountDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Account Settings</DialogTitle>
            <DialogDescription>
              Manage your Synapse account credentials and session.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 text-sm">
            <div className="rounded-md border border-border p-3 space-y-1 bg-muted/20">
              <p className="font-medium text-foreground">{displayName}</p>
              <p className="text-xs text-muted-foreground font-mono">{displaySubtitle}</p>
              <div className="pt-1">
                <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-mono capitalize">
                  {role} Account
                </span>
              </div>
            </div>

            <div className="rounded-md border border-destructive/30 p-3 space-y-3 bg-destructive/5">
              <div>
                <p className="text-sm font-medium text-destructive">Danger Zone</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Permanently delete your account. This action cannot be undone.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                className="w-full text-xs"
                onClick={() => {
                  setShowAccountDialog(false);
                  setShowDeleteConfirm(true);
                }}
              >
                Delete Account
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Explicit Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete your {role} account and revoke your access. All personal credentials and account details will be irreversibly removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingAccount}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeletingAccount}
              onClick={(e) => {
                e.preventDefault();
                handleDeleteAccount();
              }}
            >
              {isDeletingAccount ? "Deleting…" : "Yes, permanently delete my account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-all hover:-translate-y-px hover:border-border hover:text-foreground">
      {children}
    </button>
  );
}

export function Logo({ className = "size-10" }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Synapse"
      className={cn(
        "relative inline-flex items-center justify-center shrink-0 [mask-image:url(/logo.png)] [-webkit-mask-image:url(/logo.png)] [mask-size:contain] [-webkit-mask-size:contain] [mask-repeat:no-repeat] [-webkit-mask-repeat:no-repeat] [mask-position:center] [-webkit-mask-position:center] bg-[#000000] dark:bg-[#FFFFFF]",
        className
      )}
    >
      <img
        src="/logo-black.png"
        alt="Synapse"
        className="size-full object-contain dark:hidden"
      />
      <img
        src="/logo-white.png"
        alt="Synapse"
        className="size-full object-contain hidden dark:block"
      />
    </span>
  );
}
