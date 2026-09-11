import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    try {
      fn();
    } catch {
      // ignore
    }
  },
}));

import { GET as manifestGet } from "../app/api/manifest/route";
import { GET as mcpGet, POST as mcpPost } from "../app/api/mcp/route";
import { GET as agentCardGet } from "../app/agent-card.json/route";

describe("Pricing Transparency and Protocol Clarity", () => {
  describe("1. Manifest pricing transparency (GET /api/manifest)", () => {
    it("advertises explicit tiers, exact costs, and splitSummary", async () => {
      const res = await manifestGet();
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.splitSummary).toBeDefined();
      expect(data.splitSummary.free.creditCost).toBe(0);
      expect(data.splitSummary.free.services.length).toBeGreaterThanOrEqual(5);
      expect(data.splitSummary.paid.services.length).toBe(3);

      const expectedCosts: Record<string, { tier: string; cost: number }> = {
        broker: { tier: "PAID", cost: 12 },
        assay: { tier: "PAID", cost: 3 },
        shortlist: { tier: "PAID", cost: 10 },
        arena: { tier: "FREE", cost: 0 },
        sellers: { tier: "FREE", cost: 0 },
        verify: { tier: "FREE", cost: 0 },
        pubkey: { tier: "FREE", cost: 0 },
        grants: { tier: "FREE", cost: 0 },
      };

      for (const service of data.services) {
        const expected = expectedCosts[service.name];
        expect(expected, `Unexpected service in manifest: ${service.name}`).toBeDefined();
        expect(service.tier).toBe(expected.tier);
        expect(service.price.tier).toBe(expected.tier);
        expect(service.price.cost).toBe(expected.cost);
        expect(service.price.amount).toBe(expected.cost);
        expect(service.price.currency).toBe("arena-credits");
        expect(service.price.isPaid).toBe(expected.tier === "PAID");
      }
    });

    it("contains no em dashes in manifest output", async () => {
      const res = await manifestGet();
      const text = await res.text();
      expect(text.includes("—")).toBe(false);
      expect(text.includes("--")).toBe(false);
    });
  });

  describe("2. MCP pricing transparency (/api/mcp)", () => {
    it("advertises explicit tiers, costs, and splitSummary on tools/list", async () => {
      const req = new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-id": "pricing-audit" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "audit-list", method: "tools/list" }),
      });
      const res = await mcpPost(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.result.splitSummary).toBeDefined();
      expect(body.result.splitSummary.free.creditCost).toBe(0);

      const tools = body.result.tools;
      expect(tools.length).toBe(6);

      const expectedToolCosts: Record<string, { tier: string; cost: number }> = {
        yuzu_broker: { tier: "PAID", cost: 12 },
        yuzu_assay: { tier: "PAID", cost: 3 },
        yuzu_shortlist: { tier: "PAID", cost: 10 },
        yuzu_verify_receipt: { tier: "FREE", cost: 0 },
        yuzu_grant_map: { tier: "FREE", cost: 0 },
        yuzu_sellers: { tier: "FREE", cost: 0 },
      };

      for (const tool of tools) {
        const expected = expectedToolCosts[tool.name];
        expect(expected, `Unknown tool: ${tool.name}`).toBeDefined();
        expect(tool.tier).toBe(expected.tier);
        expect(tool.cost).toBe(expected.cost);
        expect(tool.pricing.tier).toBe(expected.tier);
        expect(tool.pricing.cost).toBe(expected.cost);
        expect(tool.pricing.currency).toBe("arena-credits");
        expect(tool.pricing.isPaid).toBe(expected.tier === "PAID");

        // Tool description must explicitly state [PAID: X Arena credits] or [FREE: 0 Arena credits]
        expect(tool.description).toContain(`[${expected.tier}: ${expected.cost} Arena credits]`);
      }
    });

    it("advertises pricing and splitSummary on GET /api/mcp", async () => {
      const req = new Request("http://localhost/api/mcp");
      const res = await mcpGet(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.splitSummary).toBeDefined();
      expect(Array.isArray(data.tools)).toBe(true);

      const brokerTool = data.tools.find((t: { name: string }) => t.name === "yuzu_broker");
      expect(brokerTool.tier).toBe("PAID");
      expect(brokerTool.cost).toBe(12);

      const sellersTool = data.tools.find((t: { name: string }) => t.name === "yuzu_sellers");
      expect(sellersTool.tier).toBe("FREE");
      expect(sellersTool.cost).toBe(0);
    });

    it("contains no em dashes in MCP tools and metadata", async () => {
      const req = new Request("http://localhost/api/mcp");
      const res = await mcpGet(req);
      const text = await res.text();
      expect(text.includes("—")).toBe(false);
      expect(text.includes("--")).toBe(false);
    });
  });

  describe("3. Agent Card discovery (/agent-card.json)", () => {
    it("serves unambiguous agent card with splitSummary and exact pricing matrix", async () => {
      const res = await agentCardGet();
      expect(res.status).toBe(200);

      const card = await res.json();
      expect(card.schemaVersion).toBe("v1");
      expect(card.name).toBe("Yuzu");
      expect(card.endpoints.manifest).toContain("/api/manifest");
      expect(card.endpoints.mcp).toContain("/api/mcp");

      // Verify splitSummary in agent card
      expect(card.splitSummary).toBeDefined();
      expect(card.splitSummary.free.creditCost).toBe(0);
      expect(card.splitSummary.paid.description).toBeDefined();

      // Verify matrix
      expect(card.pricing.matrix["/api/broker"].cost).toBe(12);
      expect(card.pricing.matrix["/api/broker"].tier).toBe("PAID");
      expect(card.pricing.matrix["/api/assay"].cost).toBe(3);
      expect(card.pricing.matrix["/api/assay"].tier).toBe("PAID");
      expect(card.pricing.matrix["/api/shortlist"].cost).toBe(10);
      expect(card.pricing.matrix["/api/shortlist"].tier).toBe("PAID");

      expect(card.pricing.matrix["/api/arena"].cost).toBe(0);
      expect(card.pricing.matrix["/api/arena"].tier).toBe("FREE");
      expect(card.pricing.matrix["/api/sellers"].cost).toBe(0);
      expect(card.pricing.matrix["/api/sellers"].tier).toBe("FREE");
      expect(card.pricing.matrix["/api/verify"].cost).toBe(0);
      expect(card.pricing.matrix["/api/verify"].tier).toBe("FREE");
      expect(card.pricing.matrix["/api/pubkey"].cost).toBe(0);
      expect(card.pricing.matrix["/api/pubkey"].tier).toBe("FREE");
      expect(card.pricing.matrix["/api/grants"].cost).toBe(0);
      expect(card.pricing.matrix["/api/grants"].tier).toBe("FREE");
    });

    it("contains no em dashes in agent card", async () => {
      const res = await agentCardGet();
      const text = await res.text();
      expect(text.includes("—")).toBe(false);
      expect(text.includes("--")).toBe(false);
    });
  });
});
