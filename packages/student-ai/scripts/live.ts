/// <reference types="node" />
import { createNimClient } from "@synapse/llm-client";
import { ALL_SCENARIOS, runLive, type Scenario } from "./live-lib";

// Usage (from the repo root): pnpm test:live [--scenario=a,b,c,d,e] [--review-tier=fast|main|heavy]
const arg = process.argv.find((a) => a.startsWith("--scenario="))?.slice("--scenario=".length);
const requested = arg ? arg.split(",").map((s) => s.trim()).filter(Boolean) : [...ALL_SCENARIOS];
const invalid = requested.filter((s) => !(ALL_SCENARIOS as readonly string[]).includes(s));
if (invalid.length > 0 || requested.length === 0) {
  console.error(`Unknown scenario(s): ${invalid.join(", ") || "(none given)"}. Use --scenario=a,b,c (any of ${ALL_SCENARIOS.join(", ")}).`);
  process.exit(2);
}

const tierArg = process.argv.find((a) => a.startsWith("--review-tier="))?.slice("--review-tier=".length);
if (tierArg !== undefined && !["fast", "main", "heavy"].includes(tierArg)) {
  console.error(`Unknown --review-tier "${tierArg}". Use fast, main or heavy.`);
  process.exit(2);
}

const apiKey = process.env.NVIDIA_API_KEY;
if (!apiKey) {
  console.error("NVIDIA_API_KEY is not set. Put it in .env and run this from the repo root: pnpm test:live");
  process.exit(1);
}

// Writing a note takes longer than replying "pong", so the timeout is generous. Progress is printed per call.
// The free API tier answers 503 "overloaded" now and then, so retry a few times with backoff before giving up.
const client = createNimClient({ apiKey, timeoutMs: 90_000, maxRetries: 4 });
const report = await runLive(client, {
  scenarios: requested as Scenario[],
  ...(tierArg !== undefined ? { tiers: { review: tierArg as "fast" | "main" | "heavy" } } : {}),
  log: (line) => console.log(line),
});
process.exit(report.ok ? 0 : 1);
