import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { Copy, Plus } from "lucide-react";
import { toast } from "sonner";
import { meta } from "@/lib/meta";
import { PageHeader, Section, Stat, MasteryBar, Trend, ConceptChip } from "@/components/synapse/ui";
import { NotesManager } from "@/components/synapse/NotesManager";
import { InkBars, InkLine } from "@/components/synapse/charts";
import { useClassroom, useClassroomStudents, useTests, useSubmissions, useNotes, classAverageMastery, studentsIn, useTeacherAnalyticsDashboard } from "@/services/synapse";
import { getToken } from "@/api/client";
import { conceptById, edges } from "@/demo/concepts";
import type { Student } from "@/demo/data";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { formatTimeAgo } from "@/lib/deadlines";

export const Route = createFileRoute("/teacher/classrooms/$id")({
  head: () => meta("Classroom", "Students, notes, tests and analytics for this classroom."),
  component: ClassroomPage,
});

const studentConcept = (s: Student, cid: string) => {
  const base = conceptById[cid]?.mastery ?? 60;
  const seed = [...(s.id + cid)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 21 - 10;
  const v = Math.round((base + s.mastery) / 2 + seed + (cid === s.strongest ? 20 : 0) - (cid === s.weakest ? 20 : 0));
  return Math.max(10, Math.min(98, v));
};

function ClassroomPage() {
  const { id } = Route.useParams();
  const { classroom: c, isLoading } = useClassroom(id);
  const tests = useTests(id);
  const subs = useSubmissions();
  const notes = useNotes(id);
  const { data: serverStudents } = useClassroomStudents(id);
  const { data: dashboard } = useTeacherAnalyticsDashboard();
  const token = getToken();
  const [sel, setSel] = useState<Student | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-muted-foreground">Loading classroom…</p>
      </div>
    );
  }
  if (!c) throw notFound();

  const classMetric = dashboard?.classrooms?.find((cm) => cm.id === id);

  const roster: Student[] =
    token
      ? (serverStudents ?? []).map((s) => {
          const match = studentsIn([s.id])[0];
          if (match) return match;
          const studentSubs = subs.filter((sub) => sub.studentId === s.id);
          const count = studentSubs.length;
          const avg = count > 0 ? Math.round(studentSubs.reduce((a, sub) => a + sub.score, 0) / count) : 0;
          return {
            id: s.id,
            name: s.name,
            email: s.email,
            classIds: [id],
            mastery: avg,
            avgScore: avg,
            testsCompleted: count,
            strongest: "",
            weakest: "",
            trend: count ? studentSubs.map((sub) => sub.score) : [0, 0],
          };
        })
      : studentsIn(c.studentIds);

  const conceptStats = c.conceptIds.map((cid) => ({
    id: cid,
    name: conceptById[cid]?.name ?? cid,
    v: roster.length ? Math.round(roster.reduce((a, s) => a + studentConcept(s, cid), 0) / roster.length) : 0,
  }));
  const weakest = [...conceptStats].sort((a, b) => a.v - b.v).slice(0, 4);
  const dist = [["<40", 0, 40], ["40–55", 40, 55], ["55–70", 55, 70], ["70–85", 70, 85], ["85+", 85, 101]].map(([l, lo, hi]) => ({ band: l, students: roster.filter((s) => s.mastery >= (lo as number) && s.mastery < (hi as number)).length }));
  const testPerf = tests.map((t) => { const ss = subs.filter((s) => s.testId === t.id); return { name: t.title.split(" ").slice(0, 2).join(" "), avg: ss.length ? Math.round(ss.reduce((a, s) => a + s.score, 0) / ss.length) : 0 }; });
  const rel = edges.filter(([a, b]) => c.conceptIds.includes(a) && c.conceptIds.includes(b));
  const recentSubs = subs.filter((s) => (c.studentIds.includes(s.studentId) || roster.some((r) => r.id === s.studentId)) && tests.some((t) => t.id === s.testId));

  const classActivity =
    token && dashboard
      ? dashboard.recentActivity.filter((a) => a.targetId === id)
      : (c.activity || []).map((a) => ({
          id: a.id,
          title: a.who,
          description: a.what,
          timestamp: a.when,
        }));

  return (
    <>
      <p className="mb-4 text-sm"><Link to="/teacher/classrooms" className="text-muted-foreground hover:text-foreground">← Classrooms</Link></p>
      <PageHeader eyebrow={c.subject} title={c.name} actions={
        <Button variant="outline" onClick={() => { navigator.clipboard?.writeText(c.joinCode); toast("Join code copied", { description: c.joinCode }); }}>
          <Copy className="size-4" aria-hidden="true" /> <span className="font-mono tracking-widest">{c.joinCode}</span>
        </Button>
      }>{c.description}</PageHeader>

      <Tabs defaultValue="overview">
        <TabsList className="mb-6 flex-wrap h-auto">
          {["overview", "students", "notes", "tests", "analytics"].map((t) => <TabsTrigger key={t} value={t} className="capitalize">{t}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Students" value={roster.length} />
            <Stat
              label="Avg. mastery"
              value={
                token && dashboard
                  ? roster.length > 0 ? `${classMetric?.averageMastery ?? 0}%` : "—"
                  : roster.length ? `${classAverageMastery(c.studentIds)}%` : "—"
              }
            />
            <Stat label="Published notes" value={notes.filter((n) => n.published).length} />
            <Stat label="Upcoming tests" value={tests.filter((t) => t.status === "published").length} />
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <Section title="Recent activity" className="lg:col-span-2">
              {classActivity.length > 0 ? (
                <ul className="space-y-3">
                  {classActivity.map((a) => (
                    <li key={a.id} className="flex justify-between gap-4 text-sm">
                      <span>
                        <span className="font-medium text-foreground">{a.title}</span>{" "}
                        <span className="text-muted-foreground">{a.description}</span>
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {a.timestamp.includes("-") ? formatTimeAgo(a.timestamp) : a.timestamp}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No recent activity recorded.</p>
              )}
            </Section>
            <Section title="Weakest concepts">
              {weakest.length > 0 && roster.length > 0 ? (
                <ul className="space-y-3">{weakest.map((w) => <li key={w.id}><p className="mb-1 text-sm">{w.name}</p><MasteryBar value={w.v} label={w.name} /></li>)}</ul>
              ) : (
                <p className="text-sm text-muted-foreground">No concept data available yet.</p>
              )}
            </Section>
          </div>
          <Section title="Recent submissions">
            {recentSubs.length > 0 ? (
              <ul className="divide-y divide-border text-sm">
                {recentSubs.slice(-6).reverse().map((s, i) => (
                  <li key={i} className="flex justify-between py-2"><span>{roster.find((r) => r.id === s.studentId)?.name ?? "Student"} · <span className="text-muted-foreground">{tests.find((t) => t.id === s.testId)?.title}</span></span><span className="tabular-nums">{s.score}%</span></li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No student submissions yet.</p>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="students">
          {roster.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-12 text-center">
              <h3 className="font-display text-lg">No students enrolled yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Invite students to join using code <span className="font-mono font-medium text-foreground">{c.joinCode}</span>.
              </p>
            </div>
          ) : (
            <div className="ink-card overflow-x-auto">
              <Table>
                <caption className="sr-only">Students in {c.name}</caption>
                <TableHeader><TableRow>
                  <TableHead>Name</TableHead><TableHead>Tests</TableHead><TableHead>Avg. score</TableHead><TableHead className="w-40">Mastery</TableHead><TableHead>Strongest</TableHead><TableHead>Weakest</TableHead><TableHead>Trend</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {roster.map((s) => (
                    <TableRow key={s.id} className="cursor-pointer" onClick={() => setSel(s)}>
                      <TableCell><button type="button" className="text-left underline-offset-4 hover:underline" onClick={(e) => { e.stopPropagation(); setSel(s); }}>{s.name}</button></TableCell>
                      <TableCell>{s.testsCompleted}</TableCell>
                      <TableCell className="tabular-nums">{s.avgScore}%</TableCell>
                      <TableCell><MasteryBar value={s.mastery} label={s.name} /></TableCell>
                      <TableCell>{conceptById[s.strongest]?.name ?? "—"}</TableCell>
                      <TableCell>{conceptById[s.weakest]?.name ?? "—"}</TableCell>
                      <TableCell><Trend value={(s.trend.at(-1) ?? 0) - (s.trend.at(-2) ?? 0)} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="notes"><NotesManager classroomId={c.id} /></TabsContent>

        <TabsContent value="tests">
          <div className="mb-4"><Button asChild><Link to="/teacher/tests/new" search={{ classroom: c.id }}><Plus className="size-4" aria-hidden="true" /> New test</Link></Button></div>
          {tests.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">No tests created yet for this classroom.</p>
            </div>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {tests.map((t) => {
                const ss = subs.filter((s) => s.testId === t.id);
                return (
                  <li key={t.id} className="ink-card p-4">
                    <div className="flex justify-between gap-2"><h3 className="text-lg">{t.title}</h3><span className="text-xs uppercase tracking-wider text-muted-foreground">{t.status}</span></div>
                    <p className="text-sm text-muted-foreground">{t.questions.length} questions · {t.durationMin} min · due {t.due}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">{t.conceptIds.map((id) => <ConceptChip key={id} id={id} to="none" />)}</div>
                    <p className="mt-3 text-sm">{ss.length} submissions{ss.length > 0 && ` · avg ${Math.round(ss.reduce((a, s) => a + s.score, 0) / ss.length)}%`}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="grid gap-6 lg:grid-cols-2">
          {roster.length === 0 ? (
            <div className="col-span-2 rounded-lg border border-dashed border-border p-12 text-center">
              <h3 className="font-display text-lg">No analytics data yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Analytics will appear as students join and take tests.
              </p>
            </div>
          ) : (
            <>
              <Section title="Concept mastery"><InkBars data={conceptStats} x="name" y="v" label="Class concept mastery" /></Section>
              <Section title="Mastery distribution"><InkBars data={dist.map((d) => ({ ...d, students: d.students * 20 }))} x="band" y="students" label="Share of students per mastery band" /></Section>
              <Section title="Test performance"><InkLine data={testPerf} x="name" y="avg" label="Average score per test" /></Section>
              <Section title="Student performance">
                <ul className="space-y-2">{[...roster].sort((a, b) => b.avgScore - a.avgScore).map((s) => <li key={s.id}><p className="text-sm">{s.name}</p><MasteryBar value={s.avgScore} label={s.name} /></li>)}</ul>
              </Section>
              <Section title="Concept relationships" className="lg:col-span-2">
                <ul className="flex flex-wrap gap-2 text-sm">{rel.map(([a, b]) => <li key={a + b} className="rounded-full border border-border px-3 py-1">{conceptById[a]?.name} <span aria-label="leads to" className="text-muted-foreground">→</span> {conceptById[b]?.name}</li>)}</ul>
              </Section>
            </>
          )}
        </TabsContent>
      </Tabs>

      <Sheet open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {sel && (
            <>
              <SheetHeader>
                <SheetTitle className="font-display text-3xl font-normal">{sel.name}</SheetTitle>
                <SheetDescription>{sel.testsCompleted} tests · average {sel.avgScore}% · mastery {sel.mastery}%</SheetDescription>
              </SheetHeader>
              <div className="space-y-6 px-4 pb-6">
                <div><h3 className="mb-2 text-lg">Score trend</h3><InkLine data={sel.trend.map((v, i) => ({ w: `W${i + 1}`, v }))} x="w" y="v" label={`${sel.name} score trend`} /></div>
                <div>
                  <h3 className="mb-2 text-lg">Concept breakdown</h3>
                  <ul className="space-y-2">{c.conceptIds.map((cid) => <li key={cid}><p className="text-sm">{conceptById[cid]?.name}</p><MasteryBar value={studentConcept(sel, cid)} label={conceptById[cid]?.name} /></li>)}</ul>
                </div>
                <p className="text-sm text-muted-foreground">Suggested intervention: pair {sel.name.split(" ")[0]} with a short revision set on {conceptById[sel.weakest]?.name} before the next checkpoint.</p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
