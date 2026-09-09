import { describe, expect, it } from "vitest";
import { reachThroughTools } from "@aicoo/sharedos";
import { readAgentCard } from "../lib/sharedos/directory";
import { buildContext, host, toolCatalogue } from "../lib/sharedos/host";
import { grantMap } from "../lib/sharedos/map";
import { mintOrderGrant } from "../lib/sharedos/grants";
import { depositGrant, withdrawGrant } from "../lib/sharedos/authority";
import { sellCredits } from "../lib/market/settlement";
import { PURPOSES, buyerAddress } from "../lib/sharedos/identity";

/**
 * The card is the kernel's answer to "who is this agent", so the tests that
 * matter are the ones that would still pass if we had made it up: that the read
 * is actually gated, that a stranger gets strictly less, and that the narrower
 * card is narrower by construction rather than by a redaction pass.
 */
describe("the agent card", () => {
  it("is refused when the reader holds no directory authority", async () => {
    // The mutation check for `mintDirectoryGrant`: this is the same read the
    // map makes, with the grant left unminted. If the gate were decorative, or
    // if the host were quietly minting a standing directory grant somewhere,
    // this would be served.
    const context = buildContext({ buyerId: "card-ungranted", purpose: PURPOSES.broker });
    const read = await host().kernel.readAgentCard(context, buyerAddress("card-ungranted"));

    expect(read.status).toBe("refused");
    if (read.status !== "refused") return;
    expect(read.reasonCode).toBe("no_matching_grant");
    expect(read.servableViews).toEqual([]);
  });

  it("gives the grant map its identity from the kernel rather than from the map", async () => {
    const map = await grantMap("card-self");

    // The identity view, so the map carries exactly one reach and not two taken
    // a few milliseconds apart.
    expect(map.card.view).toBe("identity");
    expect("reach" in map.card).toBe(false);
    expect(map.card.subject).toEqual({ kind: "agent", agentId: "card-self" });
    // Not two descriptions of one agent. The map reads its identity off the
    // card, so the two cannot disagree.
    expect(map.subject).toBe(map.card.subject);
    expect(map.namespace).toBe(map.card.namespaceId);
    expect(Date.parse(map.card.readAt)).not.toBeNaN();
  });

  it("serves a stranger the identity view and refuses the reach view, naming what is still available", async () => {
    const refused = await readAgentCard({
      readerId: "card-stranger",
      subjectId: "card-self",
      purpose: PURPOSES.broker,
      view: "reach",
    });

    expect(refused.relation).toBe("stranger");
    expect(refused.read.status).toBe("refused");
    if (refused.read.status !== "refused") return;
    // The kernel refuses it, and the kernel says what this reader may still ask
    // for. Neither sentence is written by us.
    expect(refused.read.servableViews).toContain("identity");
    expect(refused.read.servableViews).not.toContain("reach");

    const served = await readAgentCard({
      readerId: "card-stranger",
      subjectId: "card-self",
      purpose: PURPOSES.broker,
      view: "identity",
    });

    expect(served.read.status).toBe("served");
    if (served.read.status !== "served") return;
    expect(served.read.card.view).toBe("identity");
    expect(served.read.card.subject).toEqual({ kind: "agent", agentId: "card-self" });
    // Narrower by construction: the identity view has no reach field at all,
    // rather than a reach field that was emptied on the way out.
    expect("reach" in served.read.card).toBe(false);
  });

  it("serves the coarse namespaces view to the subject itself", async () => {
    const read = await readAgentCard({
      readerId: "card-self",
      subjectId: "card-self",
      purpose: PURPOSES.broker,
      view: "namespaces",
    });

    expect(read.read.status).toBe("served");
    if (read.read.status !== "served") return;
    expect(read.read.card.view).toBe("namespaces");
    // A `descendants` grant over the subject covers every view of it, which is
    // why one grant serves all three.
    expect("reach" in read.read.card).toBe(false);
  });
});

describe("reach through tools", () => {
  it("drops reach no offered tool operates on, and keeps the rest", async () => {
    const buyer = `card-reach-${Date.now()}`;
    const grant = mintOrderGrant({
      orderId: `ord_${buyer}`,
      buyerId: buyer,
      purpose: PURPOSES.assay,
      vendorSlugs: ["acme"],
      maxUses: 4,
      ttlMs: 60_000,
      now: new Date(),
    });
    depositGrant(grant);

    try {
      const context = buildContext({ buyerId: buyer, purpose: PURPOSES.assay });
      const reach = await host().kernel.reach(context);
      expect(reach.status).toBe("computed");
      if (reach.status !== "computed") return;

      const catalogue = await toolCatalogue(context);
      const narrowed = reachThroughTools(reach.reach, catalogue.definitions);

      // The order grant carries `sharedos/escalation` — the right to ask for
      // more — and no assay tool operates on that namespace. It is real
      // authority and it is not somewhere a turn can work through a tool, which
      // is exactly the gap the two fields exist to show.
      expect(reach.reach.some((entry) => entry.namespace === "sharedos")).toBe(true);
      expect(narrowed.some((entry) => entry.namespace === "sharedos")).toBe(false);
      expect(narrowed.some((entry) => entry.namespace === "assay")).toBe(true);
      expect(narrowed.length).toBeLessThan(reach.reach.length);
      // Descriptive, not permissive: narrowing never invents an entry.
      for (const entry of narrowed) expect(reach.reach).toContainEqual(entry);
    } finally {
      withdrawGrant(grant.id);
    }
  });

  it("is empty for an actor whose catalogue is empty", async () => {
    const map = await grantMap(`card-empty-${Date.now()}`);

    expect(map.catalogue.tools).toEqual([]);
    expect(map.reachThroughTools).toEqual([]);
  });

  it("answers the map under the purpose the live authority is actually for", async () => {
    const buyer = `card-map-${Date.now()}`;
    const sale = sellCredits({
      contractId: `ct_map_${Date.now()}`,
      buyerId: buyer,
      capabilityFamily: "creative",
      credits: 2,
      deadlineSeconds: 300,
    });
    expect(sale.ok).toBe(true);
    if (!sale.ok) return;

    try {
      const map = await grantMap(buyer);

      // The regression this guards: asked under `yuzu.broker`, reach could not
      // see a `yuzu.deliver` contract, so the map's headline field read empty
      // while `held` right beneath it listed a live grant.
      expect(map.purpose).toBe("yuzu.deliver");
      expect(map.held.some((grant) => grant.id === sale.purchase.grant.id)).toBe(true);
      expect(map.reach.status).toBe("computed");
      if (map.reach.status !== "computed") return;
      expect(map.reach.reach.length).toBeGreaterThan(0);
      expect(map.catalogue.tools).toContain("market.deliver");
      expect(map.reachThroughTools.length).toBeGreaterThan(0);
    } finally {
      withdrawGrant(sale.purchase.grant.id);
    }
  });
});
