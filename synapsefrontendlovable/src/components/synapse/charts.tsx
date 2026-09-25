import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, PolarAngleAxis, PolarGrid, Radar, RadarChart } from "recharts";

const axis = { stroke: "var(--muted-foreground)", fontSize: 12, tickLine: false, axisLine: false } as const;
const tip = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--foreground)", fontSize: 12 }, cursor: { fill: "var(--muted)" } };

export function InkBars({ data, x, y, label }: { data: Record<string, unknown>[]; x: string; y: string; label: string }) {
  return (
    <figure aria-label={label} className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: -20, right: 8 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey={x} {...axis} interval={0} angle={-25} textAnchor="end" height={60} />
          <YAxis {...axis} domain={[0, 100]} />
          <Tooltip {...tip} />
          <Bar dataKey={y} fill="var(--foreground)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <figcaption className="sr-only">{label}: {data.map((d) => `${d[x]} ${d[y]}`).join(", ")}</figcaption>
    </figure>
  );
}

export function InkLine({ data, x, y, label }: { data: Record<string, unknown>[]; x: string; y: string; label: string }) {
  return (
    <figure aria-label={label} className="h-56 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: -20, right: 12, top: 8 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey={x} {...axis} />
          <YAxis {...axis} domain={[0, 100]} />
          <Tooltip {...tip} />
          <Line type="monotone" dataKey={y} stroke="var(--foreground)" strokeWidth={1.5} dot={{ r: 3, fill: "var(--background)", stroke: "var(--foreground)" }} />
        </LineChart>
      </ResponsiveContainer>
      <figcaption className="sr-only">{label}: {data.map((d) => `${d[x]} ${d[y]}`).join(", ")}</figcaption>
    </figure>
  );
}

export function InkRadar({ data, label }: { data: { name: string; v: number }[]; label: string }) {
  return (
    <figure aria-label={label} className="h-72 w-full">
      <ResponsiveContainer>
        <RadarChart data={data}>
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis dataKey="name" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
          <Radar dataKey="v" stroke="var(--foreground)" fill="var(--foreground)" fillOpacity={0.12} />
        </RadarChart>
      </ResponsiveContainer>
      <figcaption className="sr-only">{label}: {data.map((d) => `${d.name} ${d.v}%`).join(", ")}</figcaption>
    </figure>
  );
}
