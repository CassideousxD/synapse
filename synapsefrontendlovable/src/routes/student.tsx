import { createFileRoute } from "@tanstack/react-router";
import { BarChart3, Brain, LayoutDashboard, Network, School } from "lucide-react";
import { AppShell } from "@/components/synapse/AppShell";

export const Route = createFileRoute("/student")({
  component: () => (
    <AppShell
      role="student"
      person="Student"
      subtitle="Student Portal"
      nav={[
        { to: "/student", label: "Today", icon: LayoutDashboard, exact: true },
        { to: "/student/classrooms", label: "Classes", icon: School },
        { to: "/student/graph", label: "Graph", icon: Network },
        { to: "/student/brain", label: "Revision", icon: Brain },
        { to: "/student/analytics", label: "Notebook", icon: BarChart3 },
      ]}
    />
  ),
});
