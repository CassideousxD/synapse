import { createFileRoute } from "@tanstack/react-router";
import { BarChart3, FileText, LayoutDashboard, PenSquare, School } from "lucide-react";
import { AppShell } from "@/components/synapse/AppShell";

export const Route = createFileRoute("/teacher")({
  component: () => (
    <AppShell
      role="teacher"
      person="Teacher"
      subtitle="Teacher Portal"
      nav={[
        { to: "/teacher", label: "Overview", icon: LayoutDashboard, exact: true },
        { to: "/teacher/classrooms", label: "Classes", icon: School },
        { to: "/teacher/notes", label: "Notes", icon: FileText },
        { to: "/teacher/tests", label: "Tests", icon: PenSquare },
        { to: "/teacher/analytics", label: "Analytics", icon: BarChart3 },
      ]}
    />
  ),
});
