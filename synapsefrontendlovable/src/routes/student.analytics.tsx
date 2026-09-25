import { createFileRoute, Link } from "@tanstack/react-router";
import { meta } from "@/lib/meta";
import { PageHeader, MasteryBar, Trend, StateBadge } from "@/components/synapse/ui";
import { InkLine, InkRadar } from "@/components/synapse/charts";
import { useMastery, useOverallMastery, useScoreHistory, useRecommendations } from "@/services/synapse";
import { useDemo } from "@/stores/demo-store";

export const Route = createFileRoute("/student/analytics")({
  head: () => meta("Learning notebook", "Your personal record of mastery, test performance and growth."),
  component: Notebook,
});

function Notebook() {
  const user = useDemo((s) => s.user);
  const studentName = user?.name || "Student";
  const m = useMastery();
  const overall = useOverallMastery();
  const history = useScoreHistory();
  const recs = useRecommendations();
  const assessed = m.filter((c) => c.mastery != null);
  const strong = [...assessed].sort((a, b) => b.mastery! - a.mastery!).slice(0, 5);
  const weak = [...assessed].sort((a, b) => a.mastery! - b.mastery!).slice(0, 5);
  const cats = [...new Set(m.map((c) => c.category))].map((cat) => {
    const xs = assessed.filter((c) => c.category === cat);
    return { name: cat, v: Math.round(xs.reduce((a, c) => a + c.mastery!, 0) / Math.max(1, xs.length)) };
  });
  const improving = [...assessed].sort((a, b) => b.trend - a.trend).slice(0, 4);

  return (
    <>
      <PageHeader eyebrow={`Personal notebook · ${studentName}`} title="How your understanding is growing" />
      <div className="grid gap-10 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-12">
          <section aria-labelledby="entry-1">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Entry I</p>
            <h2 id="entry-1" className="mt-1 text-3xl">Overall, you are at <em>{overall}%</em>.</h2>
            <p className="mt-3 max-w-prose text-lg leading-8 text-muted-foreground">
              {assessed.length === 0
                ? "Across your concepts, your foundations will take shape as you complete tests and assignments."
                : `Across ${assessed.length} assessed concepts, your foundations are secure — ${strong[0]?.name || "concepts"} and ${strong[1]?.name || "topics"} lead the way — while ${weak[0]?.name || "areas"} and ${weak[1]?.name || "topics"} are where the next gains will come from.`}
            </p>
          </section>

          <section aria-labelledby="entry-2">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Entry II</p>
            <h2 id="entry-2" className="mt-1 text-3xl">Test performance</h2>
            {history.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No test scores recorded yet.</p>
            ) : (
              <>
                <div className="mt-4"><InkLine data={history} x="date" y="score" label="Your test scores over time" /></div>
                <ul className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">{history.map((h) => <li key={h.label}>{h.date} — {h.label}: <span className="text-foreground">{h.score}%</span></li>)}</ul>
              </>
            )}
          </section>

          <section aria-labelledby="entry-3">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Entry III</p>
            <h2 id="entry-3" className="mt-1 text-3xl">Shape of your knowledge</h2>
            <InkRadar data={cats} label="Mastery by category" />
          </section>

          <section aria-labelledby="entry-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Entry IV</p>
            <h2 id="entry-4" className="mt-1 text-3xl">Every concept</h2>
            {assessed.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No assessed concepts yet. Complete your first test to reveal your concept breakdown.</p>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {assessed.map((c) => (
                  <li key={c.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-3 sm:grid-cols-[12rem_1fr_6rem_5rem]">
                    <Link to="/student/graph" search={{ focus: c.id }} className="font-display text-lg hover:underline">{c.name}</Link>
                    <div className="col-span-2 sm:col-span-1 sm:order-none"><MasteryBar value={c.mastery} label={c.name} /></div>
                    <StateBadge value={c.mastery} />
                    <Trend value={c.trend} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-8 lg:sticky lg:top-10 lg:self-start" aria-label="Margin notes">
          <div className="ink-card p-5">
            <h3 className="text-lg">Strongest</h3>
            {strong.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No data yet</p> : (
              <ul className="mt-2 space-y-1 text-sm">{strong.map((c) => <li key={c.id} className="flex justify-between"><span>{c.name}</span><span className="tabular-nums">{c.mastery}%</span></li>)}</ul>
            )}
          </div>
          <div className="ink-card p-5">
            <h3 className="text-lg">Weakest</h3>
            {weak.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No data yet</p> : (
              <ul className="mt-2 space-y-1 text-sm">{weak.map((c) => <li key={c.id} className="flex justify-between"><span>{c.name}</span><span className="tabular-nums">{c.mastery}%</span></li>)}</ul>
            )}
          </div>
          <div className="ink-card p-5">
            <h3 className="text-lg">Improving fastest</h3>
            {improving.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No data yet</p> : (
              <ul className="mt-2 space-y-1 text-sm">{improving.map((c) => <li key={c.id} className="flex justify-between"><span>{c.name}</span><Trend value={c.trend} /></li>)}</ul>
            )}
          </div>
          <div className="ink-card p-5">
            <h3 className="text-lg">Recommended next</h3>
            {recs.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No recommendations yet</p> : (
              <ul className="mt-2 space-y-1 text-sm">{recs.slice(0, 3).map((r) => <li key={r.concept.id}><Link to="/student/brain" search={{ c: r.concept.id }} className="hover:underline">{r.concept.name}</Link></li>)}</ul>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
