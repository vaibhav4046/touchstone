import {
  mintCapabilityRequest,
  type Capability,
  type CapabilityConstraints,
  type CapabilityRequest,
  type CapabilityRequestPayload,
} from "@aicoo/sharedos";
import { precedentKey, type Precedent } from "@aicoo/sharedos-precedent";
import { listSellers } from "../market/registry";
import { buildContext } from "./host";
import { ASSAY_NAMESPACE, PURPOSES, TOUCHSTONE, slug, type Purpose } from "./identity";
import { recordPrecedent } from "./precedent";

/**
 * The owner's answers, written down before the room opens.
 *
 * The Arena forbids a human in the loop for the two hours it runs, so the only
 * place left for a person is in front of it. This file is that place: a fixed
 * table of what Touchstone's owner will and will not authorise, recorded as
 * precedents the matcher cites when the same question arrives live.
 *
 * Nothing here is decided at run time. Every question is a literal and so is
 * every answer; what happens during the Arena is a lookup against this table,
 * not a judgement about it. A question this table does not contain is not
 * guessed at — it is named in the receipt and left for a person afterwards.
 *
 * The rows are written the first time a given buyer appears rather than at
 * import, because a precedent is keyed to who asked as well as to what was
 * asked: an owner who let one buyer read a listing did not thereby let every
 * buyer, and ADR 0022 refuses an allow whose precedent belonged to somebody
 * else. It is the same table whenever it is written, and it is written once per
 * buyer per process.
 */

/**
 * How long the owner's answers stand. The Arena runs two hours; this covers
 * setup, overrun, and the judges reading receipts afterwards.
 */
const PRECEDENT_WINDOW_MS = 4 * 60 * 60_000;

/**
 * The instant the table was written, fixed at import.
 *
 * Every envelope below is derived from it, so {@link ownerDecisions} answers
 * with the same constraints however often it is asked, and an auto-decision can
 * be compared against the precedent it cited without the clock moving between
 * the two reads.
 */
const OPENED_AT = Date.now();

/** Reading one seller's listing is several kernel actions and one human act. */
const LISTING_READS = 24;

/**
 * One approved probe is one live request, not a licence to keep knocking.
 *
 * R3 bounds one auto-decision rather than the class, so ten assays of the same
 * seller carry ten one-use grants between them. What bounds the class is the
 * host ceiling's probes-per-minute and R4's revocable matcher handle, which is
 * the same division ADR 0008 already found for delegation.
 */
const PROBE_USES = 1;

/** Credits under one contract. A credit is a use of the contract's own grant. */
const CONTRACT_DELIVERIES = 12;

/** A question, in the two dimensions that decide whether it is the same question. */
export interface OwnerQuestion {
  readonly purpose: Purpose;
  readonly capabilities: readonly Capability[];
}

export interface OwnerDecision {
  /** A handle for reading the table. Matching never looks at it. */
  readonly label: string;
  readonly question: OwnerQuestion;
  /**
   * What the owner said yes to, or absent when the owner said no.
   *
   * A refusal has no width, and that absence is load-bearing rather than tidy:
   * it is the reason a later allow cannot read a permission off a refusal.
   */
  readonly approved?: {
    readonly capabilities: readonly Capability[];
    readonly constraints: CapabilityConstraints;
  };
}

/**
 * The question as `mintCapabilityRequest` wants it.
 *
 * The payload type is mutable, and the seed and the run must mint from the
 * identical ask or the index keys do not line up. Copying here is what keeps
 * one function the single source of both.
 */
export function askPayload(question: OwnerQuestion): CapabilityRequestPayload {
  return { purpose: question.purpose, capabilities: question.capabilities.map(cloned) };
}

/**
 * The question the engine asks before probing a seller.
 *
 * Exported so the seed and the live run build it in one place. A precedent is
 * filed under the exact capability that was asked for, so a seed that spelled
 * this path differently would record an answer to a question nobody asks.
 */
export function probeQuestion(sellerSlug: string): OwnerQuestion {
  return {
    purpose: PURPOSES.probe,
    capabilities: [capability(["vendors", sellerSlug, "probe"], ["probe"], "exact")],
  };
}

/**
 * The whole table, materialised for one buyer.
 *
 * Pure: it records nothing and reads no clock. Callers that want to know what
 * the owner approved — a test, an operator, a console — read it here rather
 * than inferring it from a grant that was already issued.
 */
export function ownerDecisions(buyerId: string): readonly OwnerDecision[] {
  const buyer = slug(buyerId);
  const byLabel = new Map<string, OwnerDecision>();

  for (const seller of listSellers()) {
    // A seller is named by its id in the registry and by its name in a buyer's
    // request, and the assay slugs whichever it was given. Both spellings are
    // the same seller, so both are answered.
    for (const sellerSlug of new Set([slug(seller.id), slug(seller.name)])) {
      for (const decision of [readListing(sellerSlug), proveCapability(sellerSlug)]) {
        byLabel.set(decision.label, decision);
      }
    }
    for (const family of seller.capabilities) {
      const decision = spendBudget(family.id);
      byLabel.set(decision.label, decision);
    }
  }

  for (const decision of [refuseBuyerPrivate(buyer), refuseCredentials(buyer)]) {
    byLabel.set(decision.label, decision);
  }

  return [...byLabel.values()];
}

/**
 * Put the owner's table on the record for one buyer, once.
 *
 * Idempotent and cheap on repeat: a row already recorded is skipped before it
 * is minted, so a seller that registers mid-Arena is picked up on the next call
 * without the earlier rows being rewritten.
 */
export async function seedPrecedents(buyerId: string): Promise<void> {
  const recorded = seeded();

  for (const decision of ownerDecisions(buyerId)) {
    const memo = `${buyerId}::${decision.label}`;
    if (recorded.has(memo)) continue;

    const request = await mintCapabilityRequest(
      buildContext({ buyerId, purpose: decision.question.purpose }),
      askPayload(decision.question),
    );
    if (request === undefined) {
      // A question the schema refuses is a question the run cannot ask either,
      // so there is nothing to record and nothing hidden by not recording it:
      // the matcher finds no precedent and the receipt says which one.
      continue;
    }

    recordPrecedent(precedentFor(decision, request), request);
    recorded.add(memo);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __yuzuSeededPrecedents: Set<string> | undefined;
}

/**
 * Pinned to the process for the same reason the orders map is.
 *
 * Next evaluates a module once per route graph, and a second copy of this set
 * would silently rewrite rows the lookup already holds.
 */
function seeded(): Set<string> {
  globalThis.__yuzuSeededPrecedents ??= new Set();
  return globalThis.__yuzuSeededPrecedents;
}

/**
 * The precedent as the lookup holds it.
 *
 * `key` is the question and `capabilities` is the width allowed, and they are
 * deliberately not the same thing: the key answers "was this the same question"
 * and the capabilities answer "how much did the owner allow". Keying on the
 * width instead would record that a person approved authority the host was
 * quietly withholding.
 */
function precedentFor(decision: OwnerDecision, request: CapabilityRequest): Precedent {
  const common = {
    requestId: request.id,
    key: precedentKey(request),
    decidedAt: new Date(OPENED_AT).toISOString(),
  };

  return decision.approved === undefined
    ? { outcome: "refused", ...common }
    : {
        outcome: "approved",
        ...common,
        capabilities: decision.approved.capabilities.map(cloned),
        constraints: decision.approved.constraints,
      };
}

function readListing(sellerSlug: string): OwnerDecision {
  return {
    label: `read_listing:${sellerSlug}`,
    question: {
      purpose: PURPOSES.assay,
      capabilities: [capability(["vendors", sellerSlug, "claims"], ["read"], "exact")],
    },
    approved: {
      // The owner was answering whether a registered seller's own listing may
      // be examined at all. That is one act to a person and three actions to
      // the kernel, so the recorded width is the seller's subtree — and an
      // assay asking only to read one leaf of it comes back strictly narrower.
      // Probing is deliberately not among them: reaching the seller's live
      // endpoint is a different question with its own row below.
      capabilities: [capability(["vendors", sellerSlug], ["read", "classify", "analyze"], "descendants")],
      constraints: { purposes: [PURPOSES.assay], expiresAt: expiry(), maxUses: LISTING_READS },
    },
  };
}

function proveCapability(sellerSlug: string): OwnerDecision {
  const question = probeQuestion(sellerSlug);
  return {
    label: `prove_capability:${sellerSlug}`,
    question,
    approved: {
      // Exactly the question and no wider: one seller, one action, one live
      // request. A challenge that could be pointed anywhere is not bounded.
      capabilities: question.capabilities,
      constraints: { purposes: [PURPOSES.probe], expiresAt: expiry(), maxUses: PROBE_USES },
    },
  };
}

function spendBudget(capabilityFamily: string): OwnerDecision {
  const spend = capability(["market", capabilityFamily], ["deliver"], "exact");
  return {
    label: `spend_budget:${capabilityFamily}`,
    question: { purpose: PURPOSES.contract, capabilities: [spend] },
    approved: {
      // A contract may spend its own budget and nothing else's. The credits are
      // uses of the contract's grant, so the envelope is the budget.
      capabilities: [spend],
      constraints: { purposes: [PURPOSES.contract], expiresAt: expiry(), maxUses: CONTRACT_DELIVERIES },
    },
  };
}

/**
 * The buyer's own material is the buyer's. No seller gets to read it by asking
 * politely, and a refusal on the record is what makes that citable rather than
 * merely absent.
 */
function refuseBuyerPrivate(buyer: string): OwnerDecision {
  return {
    label: `read_buyer_private:${buyer}`,
    question: {
      purpose: PURPOSES.broker,
      capabilities: [capability(["buyers", buyer, "private"], ["read"], "descendants")],
    },
  };
}

/**
 * A seller that asks for credentials has answered the only question that
 * mattered about it. This is refused before it is asked so the answer costs
 * nothing at run time.
 */
function refuseCredentials(buyer: string): OwnerDecision {
  return {
    label: `request_credentials:${buyer}`,
    question: {
      purpose: PURPOSES.prove,
      capabilities: [capability(["buyers", buyer, "credentials"], ["read"], "descendants")],
    },
  };
}

function capability(
  path: readonly string[],
  actions: readonly string[],
  scope: "exact" | "descendants",
): Capability {
  return {
    resource: { namespace: ASSAY_NAMESPACE, path: [...path], owner: TOUCHSTONE },
    actions: [...actions],
    scope,
  };
}

function cloned(source: Capability): Capability {
  return {
    ...source,
    actions: [...source.actions],
    resource: { ...source.resource, path: [...source.resource.path] },
  };
}

function expiry(): string {
  return new Date(OPENED_AT + PRECEDENT_WINDOW_MS).toISOString();
}
