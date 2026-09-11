import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST as brokerPost, GET as brokerGet } from "../app/api/broker/route";
import { POST as streamPost, GET as streamGet } from "../app/api/broker/stream/route";
import { clearBrokerJobs, getBrokerJob } from "../lib/market/broker";

vi.mock("next/server", () => ({ after: () => undefined }));

const SAMPLE =
  "Yuzu sits between a buyer goal and the agents that answer it, taking the brief apart into a capability, budget and deadline.";

const DELIVERY = `${SAMPLE} The brief is answered in full, with the gaps named rather than filled.`;

vi.mock("../lib/assay/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/assay/llm")>();
  return {
    ...actual,
    complete: async (options: { model: string; system?: string; user: string }) => {
      const system = options.system ?? "";
      if (system.includes("procurement request")) {
        return {
          ok: true,
          ms: 1,
          text: '{"capability":"research.brief","deliverable":"A competitor brief in markdown.","constraints":["name competitors"]}',
        };
      }
      if (system.includes("proof-of-capability")) {
        return { ok: true, ms: 1, text: SAMPLE };
      }
      if (system.includes("verify delivered work")) {
        return { ok: true, ms: 1, text: '{"adherence":0.9,"quality":0.9,"accepted":true,"findings":["Answers the brief."]}' };
      }
      return { ok: true, ms: 1, text: DELIVERY, truncated: false };
    },
  };
});

describe("Asynchronous Broker Job Execution", () => {
  beforeEach(() => {
    clearBrokerJobs();
  });

  it("returns 202 Accepted with structured job descriptor when async: true is sent", async () => {
    const req = new Request("http://localhost/api/broker", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Analyze competitors for an offline note taking app",
        budget: 25,
        async: true,
      }),
    });

    const res = await brokerPost(req);
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.jobId).toMatch(/^job_[a-f0-9]+$/);
    expect(body.status).toBe("queued");
    expect(body.etaSeconds).toBeGreaterThan(0);
    expect(body.pollUrl).toBe(`/api/broker?jobId=${body.jobId}`);
    expect(body.streamUrl).toBe("/api/broker/stream");
    expect(res.headers.get("location")).toBe(`/api/broker?jobId=${body.jobId}`);
  });

  it("returns 202 Accepted when header Prefer: respond-async is provided", async () => {
    const req = new Request("http://localhost/api/broker", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Prefer: "respond-async",
      },
      body: JSON.stringify({
        goal: "Analyze competitors for an offline note taking app",
        budget: 25,
      }),
    });

    const res = await brokerPost(req);
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.jobId).toMatch(/^job_[a-f0-9]+$/);
    expect(body.status).toBe("queued");
    expect(body.etaSeconds).toBeGreaterThan(0);
    expect(body.pollUrl).toBe(`/api/broker?jobId=${body.jobId}`);
    expect(body.streamUrl).toBe("/api/broker/stream");
    expect(res.headers.get("preference-applied")).toBe("respond-async");
  });

  it("polls an in-progress and completed job via GET /api/broker?jobId=...", async () => {
    const postReq = new Request("http://localhost/api/broker", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Draft a research brief for coffee branding",
        budget: 20,
        async: true,
      }),
    });

    const postRes = await brokerPost(postReq);
    expect(postRes.status).toBe(202);
    const descriptor = await postRes.json();
    const jobId = descriptor.jobId;

    // Immediately poll: job exists
    const pollReq = new Request(`http://localhost/api/broker?jobId=${jobId}`);
    const pollRes = await brokerGet(pollReq);
    expect(pollRes.status).toBe(200);
    const pollBody = await pollRes.json();
    expect(pollBody.jobId).toBe(jobId);
    expect(["queued", "completed"]).toContain(pollBody.status);
    expect(pollBody.pollUrl).toBe(`/api/broker?jobId=${jobId}`);
    expect(pollBody.streamUrl).toBe("/api/broker/stream");

    // Wait for the background execution to complete
    let completed = false;
    for (let i = 0; i < 40; i++) {
      const check = getBrokerJob(jobId);
      if (check?.status === "completed") {
        completed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(completed).toBe(true);

    // Poll after completion: returns full outcome and signed receipt
    const completedPoll = await brokerGet(pollReq);
    expect(completedPoll.status).toBe(200);
    const completedBody = await completedPoll.json();
    expect(completedBody.status).toBe("completed");
    expect(completedBody.etaSeconds).toBe(0);
    expect(completedBody.receipt).toBeDefined();
    expect(completedBody.receipt.version).toBe("touchstone.receipt.v1");
    expect(completedBody.contract).toBeDefined();
    expect(completedBody.settlement).toBeDefined();
    expect(completedBody.result).toBeDefined();
  });

  it("returns 404 when polling a non-existent jobId", async () => {
    const pollReq = new Request("http://localhost/api/broker?jobId=job_nonexistent123");
    const pollRes = await brokerGet(pollReq);
    expect(pollRes.status).toBe(404);
    const body = await pollRes.json();
    expect(body.error).toBe("job_not_found");
  });

  it("maintains backward compatibility for GET /api/broker without jobId", async () => {
    const res = await brokerGet(new Request("http://localhost/api/broker"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service).toBe("broker");
    expect(body.method).toBe("POST");
    expect(body.sellers).toBeDefined();
    expect(body.reputations).toBeDefined();
    expect(body.body.async).toBeDefined();
  });

  it("maintains backward compatibility for synchronous POST /api/broker", async () => {
    const req = new Request("http://localhost/api/broker", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Synchronous deal without async flag",
        budget: 20,
      }),
    });

    const res = await brokerPost(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.receipt).toBeDefined();
    expect(body.receipt.version).toBe("touchstone.receipt.v1");
    expect(body.contract).toBeDefined();
    expect(body.settlement).toBeDefined();
  });

  it("streams an existing job via GET /api/broker/stream?jobId=...", async () => {
    const postReq = new Request("http://localhost/api/broker", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Stream an existing async job",
        budget: 20,
        async: true,
      }),
    });

    const postRes = await brokerPost(postReq);
    const { jobId } = await postRes.json();

    const streamReq = new Request(`http://localhost/api/broker/stream?jobId=${jobId}`);
    const streamRes = await streamGet(streamReq);
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("content-type")).toContain("text/event-stream");

    const reader = streamRes.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;

    const decoder = new TextDecoder();
    let events = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      events += decoder.decode(value, { stream: true });
      if (events.includes("event: done") || events.includes("event: failed")) {
        break;
      }
    }
    expect(events).toContain("event: open");
    expect(events).toContain(jobId);
  });

  it("streams an existing job via POST /api/broker/stream with jobId in body", async () => {
    const postReq = new Request("http://localhost/api/broker", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Stream via POST with jobId in body",
        budget: 20,
        async: true,
      }),
    });

    const postRes = await brokerPost(postReq);
    const { jobId } = await postRes.json();

    const streamReq = new Request("http://localhost/api/broker/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId }),
    });

    const streamRes = await streamPost(streamReq);
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("content-type")).toContain("text/event-stream");
  });

  it("returns 404 when streaming an unknown jobId", async () => {
    const streamReq = new Request("http://localhost/api/broker/stream?jobId=job_missing");
    const streamRes = await streamGet(streamReq);
    expect(streamRes.status).toBe(404);
    const body = await streamRes.json();
    expect(body.error).toBe("job_not_found");
  });
});
