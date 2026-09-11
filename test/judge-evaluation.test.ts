import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateCriterion, evaluateHackathonRequirements } from "../lib/judge/engine";
import { GET as judgeGet, POST as judgePost, OPTIONS as judgeOptions } from "../app/api/judge/route";

describe("Hackathon Judge Evaluation Panel Engine", () => {
  const report = evaluateHackathonRequirements();

  it("evaluates all 6 hackathon criteria with a perfect score", () => {
    expect(report.project).toBe("Yuzu");
    expect(report.criteria.length).toBe(6);
    expect(report.overallScore).toBe(60);
    expect(report.maxPossibleScore).toBe(60);
    expect(report.percentage).toBe(100);
    expect(report.allRulesMet).toBe(true);
  });

  it("evaluates exactly 3 Product Requirements scoring 10/10 each", () => {
    const productReqs = report.criteria.filter((c) => c.category === "product_requirement");
    expect(productReqs.length).toBe(3);

    for (const req of productReqs) {
      expect(req.score).toBe(10);
      expect(req.maxScore).toBe(10);
      expect(req.status).toBe("PASS");
      expect(req.citations.length).toBeGreaterThanOrEqual(3);
      expect(req.proofs.length).toBeGreaterThanOrEqual(3);
      expect(req.verificationChecks.every((check) => check.passed)).toBe(true);
    }

    expect(productReqs.map((r) => r.id)).toEqual([
      "req-1-paid-service",
      "req-2-agent-accessible",
      "req-3-top-earner-arena",
    ]);
  });

  it("evaluates exactly 3 Hard Rules scoring 10/10 each", () => {
    const hardRules = report.criteria.filter((c) => c.category === "hard_rule");
    expect(hardRules.length).toBe(3);

    for (const rule of hardRules) {
      expect(rule.score).toBe(10);
      expect(rule.maxScore).toBe(10);
      expect(rule.status).toBe("PASS");
      expect(rule.citations.length).toBeGreaterThanOrEqual(3);
      expect(rule.proofs.length).toBeGreaterThanOrEqual(3);
      expect(rule.verificationChecks.every((check) => check.passed)).toBe(true);
    }

    expect(hardRules.map((r) => r.id)).toEqual([
      "rule-1-zero-payment-system",
      "rule-2-deny-by-default",
      "rule-3-zero-credit-waste",
    ]);
  });

  it("ensures every proof citation points to an existing file in the repository", () => {
    for (const criterion of report.criteria) {
      for (const citation of criterion.citations) {
        const fullPath = resolve(process.cwd(), citation.file);
        expect(existsSync(fullPath), `Citation file ${citation.file} must exist`).toBe(true);
      }
    }
  });

  it("verifies live system state and invariants", () => {
    expect(report.systemInfo.arenaBudgetCap).toBe(100);
    expect(report.systemInfo.ed25519PublicKeyPublished).toBe(true);
    expect(report.systemInfo.mcpToolsPublishedCount).toBe(6);
    expect(report.systemInfo.registeredSellersCount).toBeGreaterThan(0);
    expect(report.systemInfo.sharedosKernelVersion).toContain("sharedos");
  });

  it("allows querying single criteria via evaluateCriterion", () => {
    const req1 = evaluateCriterion("req_1");
    expect(req1).toBeDefined();
    expect(req1?.id).toBe("req-1-paid-service");
    expect(req1?.score).toBe(10);

    const rule2 = evaluateCriterion("rule-2-deny-by-default");
    expect(rule2).toBeDefined();
    expect(rule2?.key).toBe("rule_2");
    expect(rule2?.score).toBe(10);

    const missing = evaluateCriterion("non_existent_key");
    expect(missing).toBeUndefined();
  });

  it("contains no em dashes or double hyphens in the evaluation report", () => {
    const serialized = JSON.stringify(report);
    // Em dash check (\u2014)
    expect(serialized.includes("\u2014")).toBe(false);
    // Double hyphen check in prose (excluding code identifiers)
    const prose = report.criteria.flatMap((c) => [c.title, c.requirement, c.verdict, ...c.proofs]);
    for (const text of prose) {
      expect(text.includes("--")).toBe(false);
      expect(text.includes("\u2014")).toBe(false);
    }
  });
});

describe("Hackathon Judge API Route (app/api/judge/route.ts)", () => {
  it("serves the full evaluation report via GET", async () => {
    const req = new Request("http://localhost/api/judge", { method: "GET" });
    const res = await judgeGet(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.project).toBe("Yuzu");
    expect(data.overallScore).toBe(60);
    expect(data.criteria.length).toBe(6);
    expect(data.allRulesMet).toBe(true);
  });

  it("serves specific criterion by query param", async () => {
    const req = new Request("http://localhost/api/judge?criterion=req_1", { method: "GET" });
    const res = await judgeGet(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.criterion).toBeDefined();
    expect(data.criterion.id).toBe("req-1-paid-service");
    expect(data.criterion.score).toBe(10);
  });

  it("returns 404 for unknown criterion query param", async () => {
    const req = new Request("http://localhost/api/judge?criterion=unknown_val", { method: "GET" });
    const res = await judgeGet(req);
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.error).toBe("criterion_not_found");
  });

  it("supports POST with criterion filter or empty body", async () => {
    const reqFilter = new Request("http://localhost/api/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ criterion: "rule_1" }),
    });
    const resFilter = await judgePost(reqFilter);
    expect(resFilter.status).toBe(200);
    const dataFilter = await resFilter.json();
    expect(dataFilter.criterion.key).toBe("rule_1");

    const reqFull = new Request("http://localhost/api/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const resFull = await judgePost(reqFull);
    expect(resFull.status).toBe(200);
    const dataFull = await resFull.json();
    expect(dataFull.overallScore).toBe(60);
  });

  it("handles OPTIONS request with CORS headers", async () => {
    const res = await judgeOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });
});
