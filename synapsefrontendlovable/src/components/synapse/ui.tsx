import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { conceptById, masteryState, masteryLabel } from "@/demo/concepts";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>}
        <h1 className="text-3xl md:text-4xl">{title}</h1>
        {children && <div className="mt-2 max-w-2xl text-muted-foreground">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, children, action, className }: { title: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={cn("ink-card p-5", className)} aria-label={title}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-xl">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string | undefined }) {
  return (
    <div className="ink-card ink-hover p-5">
      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-4xl">{value}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function MasteryBar({ value, label }: { value: number | null; label?: string | undefined }) {
  const v = value ?? 0;
  const st = masteryState(value);
  return (
    <div className="flex items-center gap-3">
      <div
        className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
        aria-label={label ? `${label} mastery` : "Mastery"}
        aria-valuetext={value == null ? "Unassessed" : `${v}% — ${masteryLabel[st]}`}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-700", st === "review" ? "bg-ink-soft" : "bg-foreground")}
          style={{ width: `${v}%`, backgroundImage: st === "review" ? "repeating-linear-gradient(90deg, transparent 0 3px, var(--background) 3px 5px)" : undefined }}
        />
      </div>
      <span className="w-10 text-right text-sm tabular-nums text-muted-foreground">{value == null ? "—" : `${v}%`}</span>
    </div>
  );
}

export function StateBadge({ value }: { value: number | null }) {
  const st = masteryState(value);
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
      st === "strong" && "border-foreground bg-foreground text-background",
      st === "developing" && "border-foreground text-foreground",
      st === "review" && "border-dashed border-foreground text-foreground",
      st === "unassessed" && "border-border text-muted-foreground",
    )}>
      {masteryLabel[st]}
    </span>
  );
}

export function Trend({ value }: { value: number }) {
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  return (
    <span className="inline-flex items-center gap-1 text-sm tabular-nums text-muted-foreground">
      <Icon className="size-3.5" aria-hidden="true" />
      <span>{value > 0 ? `+${value}` : value}</span>
      <span className="sr-only">{value > 0 ? "improving" : value < 0 ? "declining" : "steady"}</span>
    </span>
  );
}

export function ConceptChip({ id, name, to = "graph" }: { id: string; name?: string; to?: "graph" | "none" }) {
  const c = conceptById[id];
  const displayName =
    name ||
    c?.name ||
    id
      .replace(/^c-/, "")
      .replace(/-[a-f0-9]{4,8}$/, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());
  const cls = "inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs text-foreground transition-all hover:-translate-y-px hover:border-foreground";
  if (to === "none") return <span className={cls}>{displayName}</span>;
  return (
    <Link to="/student/graph" search={{ focus: id }} className={cls}>
      {displayName}
    </Link>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{children}</p>;
}
