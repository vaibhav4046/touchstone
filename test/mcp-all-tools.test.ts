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

import { POST as mcpPost } from "../app/api/mcp/route";

describe("MCP All 6 Tools Verification", () => {
  it("verifies all 6 tools via tools/call", async () => {
    // 1. yuzu_sellers
    const sellersReq = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-id": "mcp-test-suite" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "call-sellers",
        method: "tools/call",
        params: { name: "yuzu_sellers", arguments: {} },
      }),
    });
    const sellersRes = await mcpPost(sellersReq);
    expect(sellersRes.status).toBe(200);
    const sellersBody = await sellersRes.json();
    expect(sellersBody.result.isError).toBe(false);
    const sellersContent = JSON.parse(sellersBody.result.content[0].text);
    expect(Array.isArray(sellersContent.sellers)).toBe(true);
    expect(sellersContent.sellers.length).toBeGreaterThan(0);

    // 2. yuzu_assay
    const assayReq = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-id": "mcp-test-suite" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "call-assay",
        method: "tools/call",
        params: {
          name: "yuzu_assay",
          arguments: { vendor: "PromptCraft Labs", pitch: "Optimizing system prompts for autonomous agents.", askingPrice: 10 },
        },
      }),
    });
    const assayRes = await mcpPost(assayReq);
    expect(assayRes.status).toBe(200);
    const assayBody = await assayRes.json();
    expect(assayBody.result.isError).toBe(false);
    const assayReceipt = JSON.parse(assayBody.result.content[0].text);
    expect(assayReceipt.receiptId).toBeDefined();
    expect(assayReceipt.signature).toBeDefined();

    // 3. yuzu_verify_receipt
    const verifyReq = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-id": "mcp-test-suite" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "call-verify",
        method: "tools/call",
        params: {
          name: "yuzu_verify_receipt",
          arguments: { receipt: assayReceipt },
        },
      }),
    });
    const verifyRes = await mcpPost(verifyReq);
    expect(verifyRes.status).toBe(200);
    const verifyBody = await verifyRes.json();
    expect(verifyBody.result.isError).toBe(false);
    const verifyResult = JSON.parse(verifyBody.result.content[0].text);
    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.receiptId).toBe(assayReceipt.receiptId);

    // 4. yuzu_grant_map
    const mapReq = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-id": "mcp-test-suite" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "call-grant-map",
        method: "tools/call",
        params: {
          name: "yuzu_grant_map",
          arguments: { agent: "mcp-test-suite" },
        },
      }),
    });
    const mapRes = await mcpPost(mapReq);
    expect(mapRes.status).toBe(200);
    const mapBody = await mapRes.json();
    expect(mapBody.result.isError).toBe(false);
    const mapContent = JSON.parse(mapBody.result.content[0].text);
    expect(mapContent.subject).toBeDefined();
    expect(mapContent.card).toBeDefined();
    expect(Array.isArray(mapContent.held)).toBe(true);

    // 5. yuzu_shortlist
    const shortlistReq = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-id": "mcp-test-suite" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "call-shortlist",
        method: "tools/call",
        params: {
          name: "yuzu_shortlist",
          arguments: {
            budget: 25,
            goal: "Creative copy",
            vendors: [
              { vendor: "Alpha Copy", pitch: "We write catchy headlines for tech startups.", askingPrice: 8 },
              { vendor: "Beta Words", pitch: "Boring enterprise whitepapers only.", askingPrice: 12 },
            ],
          },
        },
      }),
    });
    const shortlistRes = await mcpPost(shortlistReq);
    expect(shortlistRes.status).toBe(200);
    const shortlistBody = await shortlistRes.json();
    expect(shortlistBody.result.isError).toBe(false);
    const shortlistContent = JSON.parse(shortlistBody.result.content[0].text);
    expect(shortlistContent.plan).toBeDefined();
    expect(Array.isArray(shortlistContent.receipts)).toBe(true);

    // 6. yuzu_broker
    const brokerReq = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-id": "mcp-test-suite" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "call-broker",
        method: "tools/call",
        params: {
          name: "yuzu_broker",
          arguments: {
            goal: "Write three taglines for cold brew coffee brand",
            budget: 25,
          },
        },
      }),
    });
    const brokerRes = await mcpPost(brokerReq);
    expect(brokerRes.status).toBe(200);
    const brokerBody = await brokerRes.json();
    expect(brokerBody.result.isError).toBe(false);
    const brokerContent = JSON.parse(brokerBody.result.content[0].text);
    expect(brokerContent.timeline).toBeDefined();
    expect(brokerContent.receipt).toBeDefined();
  }, 15000);
});
