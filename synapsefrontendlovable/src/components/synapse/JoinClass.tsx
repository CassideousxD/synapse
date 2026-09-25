import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDemo } from "@/stores/demo-store";
import { getToken } from "@/api/client";
import { apiJoinClassroom, invalidateQueries } from "@/services/synapse";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function JoinClass() {
  const queryClient = useQueryClient();
  const joinDemo = useDemo((s) => s.joinClass);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < 6 || loading) return;
    setLoading(true);
    setMsg(null);

    const token = getToken();
    if (token) {
      try {
        const res = await apiJoinClassroom(code);
        if (res.ok && res.classroom) {
          await invalidateQueries.classroomJoined(queryClient, res.classroom.id);
          setMsg({ ok: true, text: `Enrolled in ${res.classroom.name}` });
          toast.success(`Enrolled in ${res.classroom.name}`);
          setCode("");
        } else {
          const reason = res.reason || "Failed to join classroom";
          setMsg({ ok: false, text: reason });
          toast.error(reason);
        }
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : "Failed to join classroom";
        setMsg({ ok: false, text: reason });
        toast.error(reason);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Demo Mode
    const r = joinDemo(code);
    setMsg(r.ok ? { ok: true, text: `Enrolled in ${r.classroom.name}` } : { ok: false, text: r.reason });
    if (r.ok) {
      setCode("");
      toast.success(`Enrolled in ${r.classroom.name}`);
    }
    setLoading(false);
  };

  return (
    <form
      className="ink-card p-5"
      onSubmit={handleSubmit}
    >
      <h2 className="text-xl">Join a class</h2>
      <p className="mt-1 text-sm text-muted-foreground">Enter the six-character code from your teacher. Try <span className="font-mono">K9X2P4</span>.</p>
      <div className="mt-4 flex gap-2">
        <Label htmlFor="join-code" className="sr-only">Class code</Label>
        <Input
          id="join-code"
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase().slice(0, 6)); setMsg(null); }}
          placeholder="K9X2P4"
          className="font-mono tracking-[0.3em] uppercase"
          aria-invalid={msg?.ok === false}
          aria-describedby="join-msg"
          autoComplete="off"
        />
        <Button type="submit" disabled={code.length < 6 || loading}>
          {loading ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Joining...
            </>
          ) : (
            "Join class"
          )}
        </Button>
      </div>
      <div id="join-msg" aria-live="polite" className="min-h-6 pt-2 text-sm">
        <AnimatePresence mode="wait">
          {msg && (
            <motion.p key={msg.text} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={msg.ok ? "flex items-center gap-2 text-foreground" : "text-muted-foreground"}>
              {msg.ok && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 15 }} className="flex size-5 items-center justify-center rounded-full bg-foreground text-background">
                  <Check className="size-3" aria-hidden="true" />
                </motion.span>
              )}
              {!msg.ok && <span aria-hidden="true">✕ </span>}{msg.text}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </form>
  );
}
