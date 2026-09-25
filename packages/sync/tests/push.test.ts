import { describe, it, expect, vi } from "vitest";
import { pushAnalysisPayload, PushError } from "../src";
import type { AnalysisPayload } from "@synapse/contracts";

const payload: AnalysisPayload = {
  studentId: "s1",
  conceptId: "c1",
  mastery: 0.5,
  trend: "still_weak",
  computedAt: "2026-01-01T00:00:00Z",
};
const noSleep = async () => {};

describe("pushAnalysisPayload", () => {
  it("posts to /analytics/payload and resolves on 2xx", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await pushAnalysisPayload(payload, { fetch: fetchMock, sleep: noSleep });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/analytics/payload");
    expect(JSON.parse(init!.body as string)).toEqual(payload);
  });

  it("retries a 503 then succeeds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await pushAnalysisPayload(payload, { fetch: fetchMock, sleep: noSleep });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad", { status: 400 }));
    await expect(pushAnalysisPayload(payload, { fetch: fetchMock, sleep: noSleep })).rejects.toMatchObject({
      status: 400,
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxRetries on persistent 500s", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(
      pushAnalysisPayload(payload, { fetch: fetchMock, sleep: noSleep, maxRetries: 1 }),
    ).rejects.toBeInstanceOf(PushError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
