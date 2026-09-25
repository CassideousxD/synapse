import { createFileRoute } from "@tanstack/react-router";
import { RoleSelect } from "./index";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Synapse demo" },
      { name: "description", content: "Pick a demo role to enter Synapse." },
      { property: "og:title", content: "Sign in — Synapse demo" },
      { property: "og:description", content: "Pick a demo role to enter Synapse." },
    ],
  }),
  component: RoleSelect,
});
