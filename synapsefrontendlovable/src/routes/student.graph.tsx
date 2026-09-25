import { createFileRoute, Link, useNavigate, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronRight, Maximize2, Search, X } from "lucide-react";
import { z } from "zod";
import { meta } from "@/lib/meta";
import { MasteryBar, StateBadge, Trend } from "@/components/synapse/ui";
import { useDemo } from "@/stores/demo-store";
import { useNotes, useMastery } from "@/services/synapse";
import { concepts, conceptById, neighbours, edges } from "@/demo/concepts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PracticeButton } from "@/components/synapse/PracticeButton";

const GraphScene = lazy(() => import("@/components/synapse/GraphScene"));

export const Route = createFileRoute("/student/graph")({
  validateSearch: z.object({ focus: z.string().optional() }),
  head: () => meta("Knowledge graph", "Explore everything you know as an interactive 3D graph of concepts."),
  component: GraphPage,
});

function GraphPage() {
  const { focus } = Route.useSearch();
  const navigate = useNavigate({ from: "/student/graph" });
  const user = useDemo((s) => s.user);
  const demoMastery = useDemo((s) => s.mastery);
  const conceptMasteryList = useMastery();

  const activeConceptIds = useMemo(
    () => new Set(conceptMasteryList.map((c) => c.id)),
    [conceptMasteryList],
  );

  const activeEdges = useMemo(() => {
    if (!user) return edges;
    const computed: [string, string][] = [];
    const seen = new Set<string>();
    for (const [a, b] of edges) {
      if (activeConceptIds.has(a) && activeConceptIds.has(b)) {
        computed.push([a, b]);
        seen.add(`${a}::${b}`);
        seen.add(`${b}::${a}`);
      }
    }
    for (const item of conceptMasteryList) {
      const rels = (item as unknown as { relatedConceptIds?: string[] }).relatedConceptIds;
      if (rels) {
        for (const relId of rels) {
          if (activeConceptIds.has(relId) && !seen.has(`${item.id}::${relId}`)) {
            computed.push([item.id, relId]);
            seen.add(`${item.id}::${relId}`);
            seen.add(`${relId}::${item.id}`);
          }
        }
      }
    }
    return computed;
  }, [user, activeConceptIds, conceptMasteryList]);

  const mastery = useMemo(() => {
    if (!user) return demoMastery;
    const res: Record<string, number | null> = {};
    for (const c of conceptMasteryList) {
      res[c.id] = c.mastery;
    }
    return res;
  }, [user, demoMastery, conceptMasteryList]);

  const dark = useDemo((s) => s.theme) === "dark";
  const notes = useNotes();
  const [q, setQ] = useState("");
  const [fitTrigger, setFitTrigger] = useState(0);
  const [legendOpen, setLegendOpen] = useState(true);
  const selected = focus && activeConceptIds.has(focus) ? focus : null;
  const select = (id: string | null) => {
    if (id === null && !focus) return;
    if (id !== null && id === focus) return;
    navigate({ search: id ? { focus: id } : {}, replace: true });
  };
  const results = useMemo(
    () =>
      q.trim()
        ? conceptMasteryList
            .filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))
            .slice(0, 6)
        : [],
    [q, conceptMasteryList],
  );
  const c = selected
    ? conceptMasteryList.find((x) => x.id === selected) || conceptById[selected] || null
    : null;
  const m = selected ? mastery[selected] ?? null : null;
  const related = c
    ? notes.filter(
        (n) =>
          n?.published &&
          ((Array.isArray(n.conceptIds) && n.conceptIds.includes(c.id)) ||
            (Array.isArray(n.sections) && n.sections.some((s) => s?.conceptId === c.id))),
      )
    : [];

  const connectedNeighbours = useMemo(() => {
    if (!c) return [];
    const list: string[] = [];
    for (const [a, b] of activeEdges) {
      if (a === c.id && !list.includes(b)) list.push(b);
      else if (b === c.id && !list.includes(a)) list.push(a);
    }
    return list;
  }, [c, activeEdges]);

  return (
    <div className="relative -mx-4 -mt-6 h-[calc(100vh-7.5rem)] overflow-hidden md:-mx-8 md:-mt-10 md:h-screen lg:-mx-12">
      <h1 className="sr-only">Knowledge graph</h1>
      <ClientOnly fallback={<p className="p-8 text-muted-foreground">Loading your graph…</p>}>
        <Suspense fallback={<p className="p-8 text-muted-foreground">Loading your graph…</p>}>
          <div className="absolute inset-0 z-0">
            <GraphScene
              mastery={mastery}
              selected={selected}
              onSelect={select}
              dark={dark}
              concepts={conceptMasteryList}
              edges={activeEdges}
              fitTrigger={fitTrigger}
            />
          </div>
        </Suspense>
      </ClientOnly>

      {conceptMasteryList.length === 0 ? (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-6 z-20">
          <div className="ink-card pointer-events-auto max-w-md p-8 text-center shadow-lg backdrop-blur-md">
            <h2 className="font-display text-2xl">Your knowledge space is empty</h2>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              Join a classroom and complete your first learning session to start building your knowledge graph.
            </p>
            <Button asChild className="mt-6" size="sm">
              <Link to="/student/classrooms">Browse Classrooms</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="absolute left-4 top-4 z-20 w-[min(24rem,calc(100%-2rem))] md:left-8 md:top-8 pointer-events-auto">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                aria-label="Search concepts"
                placeholder="Search concepts..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && results[0]) { select(results[0].id); setQ(""); } }}
                className="bg-background/90 pl-9 backdrop-blur"
                role="combobox"
                aria-expanded={results.length > 0}
                aria-controls="graph-results"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              className="size-9 shrink-0 bg-background/90 backdrop-blur"
              title="Fit all concepts to view"
              aria-label="Fit all concepts to view"
              onClick={() => {
                select(null);
                setFitTrigger((t) => t + 1);
              }}
            >
              <Maximize2 className="size-4" />
            </Button>
          </div>
          {results.length > 0 && (
            <ul id="graph-results" role="listbox" className="mt-1 overflow-hidden rounded-md border border-border bg-popover">
              {results.map((r) => (
                <li key={r.id} role="option" aria-selected={false}>
                  <button type="button" onClick={() => { select(r.id); setQ(""); }} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-accent">
                    <span>{r.name}</span><span className="text-muted-foreground">{r.category}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 hidden rounded-md border border-border bg-background/90 text-xs backdrop-blur-md md:block shadow-sm overflow-hidden transition-all duration-200">
            {/* Header: clickable to toggle collapse */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 bg-muted/20">
              <button
                type="button"
                onClick={() => setLegendOpen((v) => !v)}
                className="flex items-center gap-1.5 font-medium text-foreground hover:text-primary transition-colors focus:outline-hidden cursor-pointer"
                aria-expanded={legendOpen}
                aria-controls="graph-legend-content"
              >
                {legendOpen ? (
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                )}
                <span>Graph legend</span>
              </button>

              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] gap-1 shrink-0 text-muted-foreground hover:text-foreground hover:bg-background/80"
                onClick={(e) => {
                  e.stopPropagation();
                  select(null);
                  setFitTrigger((t) => t + 1);
                }}
              >
                <Maximize2 className="size-3" />
                Fit View
              </Button>
            </div>

            {/* Collapsible Content */}
            {legendOpen && (
              <div id="graph-legend-content" className="p-3 space-y-2.5">
                <div className="grid grid-cols-[1rem_1fr_auto] items-center gap-x-2.5 gap-y-2 text-xs">
                  {/* Row 1: Strong - Monochrome solid circle */}
                  <div className="flex items-center justify-center size-4" aria-hidden="true">
                    <span className="size-2 rounded-full bg-foreground inline-block" />
                  </div>
                  <span className="font-medium text-foreground">Strong</span>
                  <span className="font-mono text-[11px] text-muted-foreground text-right">≥ 75%</span>

                  {/* Row 2: Developing - Monochrome outlined ring/circle */}
                  <div className="flex items-center justify-center size-4" aria-hidden="true">
                    <span className="size-2.5 rounded-full border-[1.5px] border-foreground bg-transparent inline-block" />
                  </div>
                  <span className="font-medium text-foreground">Developing</span>
                  <span className="font-mono text-[11px] text-muted-foreground text-right">45–74%</span>

                  {/* Row 3: Needs review - Monochrome outlined square */}
                  <div className="flex items-center justify-center size-4" aria-hidden="true">
                    <span className="size-2.5 border-[1.5px] border-foreground/80 bg-transparent rounded-[1px] inline-block" />
                  </div>
                  <span className="font-medium text-foreground">Needs review</span>
                  <span className="font-mono text-[11px] text-muted-foreground text-right">&lt; 45%</span>

                  {/* Row 4: Unassessed - Monochrome outlined diamond */}
                  <div className="flex items-center justify-center size-4" aria-hidden="true">
                    <span className="size-2 rotate-45 border-[1.5px] border-foreground/60 bg-transparent inline-block" />
                  </div>
                  <span className="font-medium text-foreground">Unassessed</span>
                  <span className="font-mono text-[11px] text-muted-foreground text-right">—</span>
                </div>

                <div className="pt-2 border-t border-border/40 text-[11px] text-muted-foreground leading-snug">
                  Drag to rotate · Right-drag to pan · Scroll to zoom
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Accessible list alternative */}
      {conceptMasteryList.length > 0 && (
        <details className="absolute bottom-4 left-4 z-20 max-w-xs rounded-md border border-border bg-background/90 p-2 text-sm backdrop-blur md:bottom-8 md:left-8">
          <summary className="cursor-pointer text-muted-foreground">Browse all {conceptMasteryList.length} concepts</summary>
          <ul className="mt-2 max-h-60 overflow-y-auto">
            {conceptMasteryList.map((x) => <li key={x.id}><button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-accent" onClick={() => select(x.id)}>{x.name}</button></li>)}
          </ul>
        </details>
      )}

      <AnimatePresence>
        {c && (
          <motion.aside
            key={c.id}
            aria-label={`${c.name} details`}
            initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className="absolute inset-x-2 bottom-2 z-30 max-h-[60%] overflow-y-auto rounded-lg border border-border bg-card/95 p-5 backdrop-blur md:inset-x-auto md:bottom-8 md:right-8 md:top-8 md:max-h-none md:w-96"
          >
            <div className="flex items-start justify-between">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{c.category}</p>
              <Button variant="ghost" size="icon" aria-label="Close concept details" onClick={() => select(null)}><X className="size-4" /></Button>
            </div>
            <h2 className="text-3xl">{c.name}</h2>
            <div className="mt-3 flex items-center gap-3"><StateBadge value={m} /><Trend value={c.trend} /></div>
            <div className="mt-3"><MasteryBar value={m} label={c.name} /></div>
            <p className="mt-4 leading-7">{c.description}</p>
            <h3 className="mt-5 text-lg">Connected concepts</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {connectedNeighbours.length ? (
                connectedNeighbours.map((n) => {
                  const node = conceptMasteryList.find((x) => x.id === n) || conceptById[n];
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => select(n)}
                      className="rounded-full border border-border px-2.5 py-0.5 text-xs transition-all hover:-translate-y-px hover:border-foreground"
                    >
                      {node?.name || n}
                    </button>
                  );
                })
              ) : (
                <p className="text-xs text-muted-foreground">No directly linked concepts.</p>
              )}
            </div>
            <h3 className="mt-5 text-lg">Related notes</h3>
            {related.length ? (
              <ul className="mt-1 space-y-1 text-sm">{related.map((n) => {
                const sec = n.sections.find((s) => s.conceptId === c.id);
                return <li key={n.id}><Link to="/student/notes/$id" params={{ id: n.id }} search={sec ? { section: sec.id } : {}} className="underline underline-offset-4">{n.title}{sec ? ` — ${sec.heading}` : ""}</Link></li>;
              })}</ul>
            ) : <p className="mt-1 text-sm text-muted-foreground">No notes published for this concept yet.</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              {related[0] && <Button asChild variant="outline"><Link to="/student/notes/$id" params={{ id: related[0].id }}>Open notes</Link></Button>}
              <PracticeButton conceptId={c.id} />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
