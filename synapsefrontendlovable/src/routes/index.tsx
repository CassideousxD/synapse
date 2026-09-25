import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, BookOpen, GraduationCap } from "lucide-react";
import { toast } from "sonner";
import { useDemo, type DemoRole } from "@/stores/demo-store";
import { Logo } from "@/components/synapse/AppShell";
import { login, registerTeacher, registerStudent } from "@/api/auth";
import {
  getToken,
  clearToken,
  getRoleToken,
  setRoleToken,
  getRoleUser,
  setRoleUser,
  setActiveRole,
  getRememberedEmail,
  isRememberMeEnabled,
  saveRememberMe,
} from "@/api/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Synapse — Sign in or create an account" },
      { name: "description", content: "Sign in to Synapse as a teacher or a student." },
      { property: "og:title", content: "Synapse — Sign in or create an account" },
      { property: "og:description", content: "An adaptive learning notebook with a 3D knowledge graph." },
    ],
  }),
  component: RoleSelect,
});

export function RoleSelect() {
  const queryClient = useQueryClient();
  const currentUser = useDemo((s) => s.user);
  const currentRole = useDemo((s) => s.role);
  const setRole = useDemo((s) => s.setRole);
  const setUser = useDemo((s) => s.setUser);
  const navigate = useNavigate();

  // If user already has an active session (e.g. from Remember Me), automatically resume into portal
  useEffect(() => {
    const token = getToken();
    if (token && currentUser && currentRole) {
      navigate({ to: currentRole === "teacher" ? "/teacher" : "/student", replace: true });
    }
  }, [currentUser, currentRole, navigate]);

  const [dialogRole, setDialogRole] = useState<DemoRole | null>(null);
  const [activeTab, setActiveTab] = useState<"signin" | "register">("signin");

  // Form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openAuth = (role: DemoRole) => {
    // 1. Check if a remembered session exists for this specific role
    const roleToken = getRoleToken(role);
    const roleUser = getRoleUser(role);

    if (roleToken && roleUser && roleUser.role === role) {
      // Remembered! Directly redirect to the portal without asking for password!
      setActiveRole(role);
      setUser(roleUser);
      setRole(role);
      navigate({ to: role === "teacher" ? "/teacher" : "/student" });
      return;
    }

    // 2. No active session for this role: open the login dialog
    setActiveRole(role);
    setDialogRole(role);
    setActiveTab("signin");
    setError(null);

    // Pre-fill only this specific role's remembered email
    const savedEmail = getRememberedEmail(role);
    const isRemembered = isRememberMeEnabled(role) || Boolean(savedEmail);
    setEmail(savedEmail);
    setPassword("");
    setName("");
    setRememberMe(isRemembered);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dialogRole) return;
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);

    try {
      const res = await login({ email: email.trim(), password, rememberMe });
      if (res.user) {
        const authUser = {
          id: res.user.id,
          name: res.user.name,
          email: res.user.email,
          role: res.user.role,
        };
        // Persist role-specific session and credentials
        setRoleToken(dialogRole, res.accessToken, rememberMe);
        setRoleUser(dialogRole, authUser, rememberMe);
        saveRememberMe(dialogRole, email.trim(), rememberMe);
        setActiveRole(dialogRole);
        setUser(authUser);
      }
      setRole(dialogRole);
      queryClient.clear();
      toast.success(
        rememberMe
          ? `Welcome back, ${res.user?.name || dialogRole}! Remembered on this device.`
          : `Signed in successfully as ${res.user?.name || dialogRole}`
      );
      setDialogRole(null);
      navigate({ to: dialogRole === "teacher" ? "/teacher" : "/student" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to sign in";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dialogRole) return;
    if (!name.trim() || !email.trim() || !password) return;
    setLoading(true);
    setError(null);

    try {
      const payload = { name: name.trim(), email: email.trim(), password, rememberMe };
      const res =
        dialogRole === "teacher"
          ? await registerTeacher(payload)
          : await registerStudent(payload);

      if (res.user) {
        const authUser = {
          id: res.user.id,
          name: res.user.name,
          email: res.user.email,
          role: res.user.role,
        };
        // Persist role-specific session and credentials
        setRoleToken(dialogRole, res.accessToken, rememberMe);
        setRoleUser(dialogRole, authUser, rememberMe);
        saveRememberMe(dialogRole, email.trim(), rememberMe);
        setActiveRole(dialogRole);
        setUser(authUser);
      }
      setRole(dialogRole);
      queryClient.clear();
      toast.success(
        rememberMe
          ? `Account created! Welcome, ${res.user?.name || name} (remembered on this device).`
          : `Account created! Welcome, ${res.user?.name || name}`
      );
      setDialogRole(null);
      navigate({ to: dialogRole === "teacher" ? "/teacher" : "/student" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Registration failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const enterDemoMode = () => {
    if (!dialogRole) return;
    queryClient.clear();
    setRole(dialogRole);
    setDialogRole(null);
    navigate({ to: dialogRole === "teacher" ? "/teacher" : "/student" });
  };

  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
        <div className="mb-10 flex items-center gap-3"><Logo /><span className="font-display text-2xl">Synapse</span></div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Adaptive learning · Demo edition</p>
        <h1 className="mt-4 max-w-3xl text-4xl leading-tight md:text-6xl">
          A quiet notebook that learns <em className="italic text-muted-foreground">how you learn.</em>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Classrooms, tests and tailored revision — mapped onto a living, three-dimensional graph of everything you know.
        </p>
      </motion.div>

      <div className="mt-12 grid gap-4 md:grid-cols-2">
        <RoleCard
          onClick={() => openAuth("teacher")}
          icon={<BookOpen className="size-5" aria-hidden="true" />}
          title="Teacher Portal"
          desc="Manage classrooms, publish notes, build tests and read class analytics."
        />
        <RoleCard
          onClick={() => openAuth("student")}
          icon={<GraduationCap className="size-5" aria-hidden="true" />}
          title="Student Portal"
          desc="Join classrooms, take tests, explore your 3D knowledge graph and follow tailored revision."
        />
      </div>
      {currentUser && (
        <div className="mt-8 rounded-lg border border-primary/30 bg-primary/5 p-4 text-center">
          <p className="text-sm">
            Signed in as <strong className="font-semibold text-foreground">{currentUser.name}</strong> ({currentUser.email})
          </p>
          <div className="mt-3 flex justify-center gap-3">
            <Button
              size="sm"
              onClick={() => navigate({ to: currentUser.role === "teacher" ? "/teacher" : "/student" })}
            >
              Continue to {currentUser.role === "teacher" ? "Teacher Portal" : "Student Portal"} →
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                useDemo.getState().setUser(null);
                setRole(null);
                clearToken();
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      )}
      <p className="mt-8 text-sm text-muted-foreground">
        Secure account authentication · Sign in or create an account to enter.
      </p>

      {/* Authentication Modal */}
      <Dialog open={dialogRole !== null} onOpenChange={(open) => !open && setDialogRole(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-normal">
              {dialogRole === "teacher" ? "Teacher Portal" : "Student Portal"}
            </DialogTitle>
            <DialogDescription>
              {dialogRole === "teacher"
                ? "Sign in to manage your classrooms, or create a new teacher account."
                : "Sign in to access your classes and knowledge graph, or create an account."}
            </DialogDescription>
          </DialogHeader>

          <Tabs
            value={activeTab}
            onValueChange={(v) => {
              setActiveTab(v as "signin" | "register");
              setError(null);
            }}
            className="w-full mt-2"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="register">Create Account</TabsTrigger>
            </TabsList>

            {error && (
              <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <TabsContent value="signin" className="space-y-4 pt-4">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email or Username</Label>
                  <Input
                    id="signin-email"
                    type="text"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={
                      dialogRole === "teacher"
                        ? "teacher@university.edu"
                        : "student@college.edu"
                    }
                    autoComplete="username"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">Password</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                </div>
                <div className="flex items-start space-x-2 pt-1">
                  <Checkbox
                    id="signin-remember"
                    checked={rememberMe}
                    onCheckedChange={(c) => setRememberMe(Boolean(c))}
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor="signin-remember"
                    className="grid gap-0.5 leading-none cursor-pointer select-none font-normal"
                  >
                    <span className="text-xs font-medium text-foreground">
                      Remember me on this device
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Keeps you signed in for 30 days and remembers your email.
                    </span>
                  </Label>
                </div>
                <div className="flex flex-col gap-2 pt-2">
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Signing in…" : "Sign In"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={enterDemoMode}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Or explore in Demo Mode →
                  </Button>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="register" className="space-y-4 pt-4">
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reg-name">Full Name</Label>
                  <Input
                    id="reg-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={
                      dialogRole === "teacher"
                        ? "e.g. Dr. Jane Doe"
                        : "e.g. Alex Smith"
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-email">Email Address</Label>
                  <Input
                    id="reg-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={
                      dialogRole === "teacher"
                        ? "teacher@university.edu"
                        : "student@college.edu"
                    }
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-password">Password (min 6 chars)</Label>
                  <Input
                    id="reg-password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </div>
                <div className="flex items-start space-x-2 pt-1">
                  <Checkbox
                    id="reg-remember"
                    checked={rememberMe}
                    onCheckedChange={(c) => setRememberMe(Boolean(c))}
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor="reg-remember"
                    className="grid gap-0.5 leading-none cursor-pointer select-none font-normal"
                  >
                    <span className="text-xs font-medium text-foreground">
                      Remember me on this device
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Keeps you signed in for 30 days and remembers your email.
                    </span>
                  </Label>
                </div>
                <div className="flex flex-col gap-2 pt-2">
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Creating account…" : "Create Account"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={enterDemoMode}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Or explore in Demo Mode →
                  </Button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function RoleCard({
  onClick,
  icon,
  title,
  desc,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      className="ink-card group flex flex-col items-start gap-4 p-6 text-left hover:border-foreground"
    >
      <span className="flex size-10 items-center justify-center rounded-full border border-border">
        {icon}
      </span>
      <span>
        <span className="block font-display text-2xl">{title}</span>
      </span>
      <span className="text-muted-foreground">{desc}</span>
      <span className="mt-2 inline-flex items-center gap-2 text-sm">
        Enter{" "}
        <ArrowRight
          className="size-4 transition-transform group-hover:translate-x-1"
          aria-hidden="true"
        />
      </span>
    </motion.button>
  );
}
