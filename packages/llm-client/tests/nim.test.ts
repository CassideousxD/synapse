import { describe, it, expect, vi } from "vitest";
import { createNimClient, LlmError, type ChatRequest } from "../src";

const ok = (content: string) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    }),
    { status: 200 },
  );

const noSleep = async () => {};
const req: ChatRequest = { tier: "main", messages: [{ role: "user", content: "hi" }] };

describe("createNimClient", () => {
  it("routes the tier to the right model and sends the key", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok("hello"));
    const client = createNimClient({ apiKey: "k", fetch: fetchMock, sleep: noSleep });

    const out = await client.chat(req);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(JSON.parse(init!.body as string).model).toBe("nvidia/nemotron-3-super-120b-a12b");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(out).toMatchObject({ content: "hello", usage: { promptTokens: 3, completionTokens: 2 } });
  });

  it("retries a 429 and then succeeds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(ok("finally"));
    const client = createNimClient({ fetch: fetchMock, sleep: noSleep });

    expect((await client.chat(req)).content).toBe("finally");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxRetries", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response("boom", { status: 500 }));
    const client = createNimClient({ fetch: fetchMock, sleep: noSleep, maxRetries: 2 });

    await expect(client.chat(req)).rejects.toBeInstanceOf(LlmError);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 try + 2 retries
  });

  it("does not retry a 401", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response("no", { status: 401 }));
    const client = createNimClient({ fetch: fetchMock, sleep: noSleep });

    await expect(client.chat(req)).rejects.toMatchObject({ status: 401, retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("errors clearly when the response has no content", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: null } }] }), { status: 200 }));
    const client = createNimClient({ fetch: fetchMock, sleep: noSleep });

    await expect(client.chat(req)).rejects.toThrow(/no message content/);
  });
});
