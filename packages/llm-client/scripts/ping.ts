import { createNimClient } from "../src";

const apiKey = process.env.NVIDIA_API_KEY;
if (!apiKey) {
  console.error("Set NVIDIA_API_KEY first: export NVIDIA_API_KEY=nvapi-...");
  process.exit(1);
}

const client = createNimClient({ apiKey, timeoutMs: 20_000, maxRetries: 1 });

for (const tier of ["fast", "main", "heavy"] as const) {
  const t0 = Date.now();
  try {
    const r = await client.chat({
      tier,
      messages: [{ role: "user", content: "Reply with exactly: pong" }],
      maxTokens: 256,
    });
    console.log(`${tier} (${r.model}) ${Date.now() - t0}ms ->`, r.content.trim());
  } catch (e) {
    console.error(`${tier} failed:`, (e as Error).message);
  }
}
