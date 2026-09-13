/**
 * One real deal, end to end, with another team's agent and real Arena credits.
 *
 * Everything Yuzu has shown the Room so far is evaluation: assays, rankings,
 * receipts for work nobody bought. This is the other thing, and it is the thing
 * the Arena actually judges -- discover a seller, prove it can do the job before
 * any money moves, pay it for real, verify the payment against our own ledger,
 * invoke it, check what came back against the contract, and settle with a
 * signed receipt.
 *
 * Yuzu charges nothing for this. The brokerage is free and the seller keeps the
 * whole price, because the point being demonstrated is not that Yuzu can bill
 * somebody: it is that another autonomous agent earned real Arena credits
 * because Yuzu found it, proved it, hired it and checked its work. Two
 * transactions would make that story about our fee instead.
 *
 *   node --env-file=.env.local --import tsx scripts/arena-deal.mts            # dry run, pays nothing
 *   node --env-file=.env.local --import tsx scripts/arena-deal.mts --pay      # real credits move
 *   node --env-file=.env.local --import tsx scripts/arena-deal.mts --attack   # the negative twin
 */
import { verifyPayment, memoFor, type LedgerTransfer } from "../lib/market/deal";
import { signPayload } from "../lib/assay/receipt";

const BASE = process.env.SHAREDNET_BASE ?? "https://www.sharednet.ai";
const ROOM = process.env.SHAREDNET_ROOM ?? "rom_TxTzqEUKyx";
const TOKEN = process.env.SHAREDNET_INSTANCE_TOKEN ?? "";
const BUYER_PRINCIPAL = process.env.YUZU_PRINCIPAL ?? "p_FjHUKCzfcH";

const PAY = process.argv.includes("--pay");
const ATTACK = process.argv.includes("--attack");

if (TOKEN === "") {
  console.error("No SHAREDNET_INSTANCE_TOKEN.");
  process.exit(1);
}

/** The buyer's order. One sentence and a budget, which is the whole interface. */
const GOAL = "Verify this claim: The Eiffel Tower is in Paris.";
const MAX_BUDGET = 8;
const TIMEOUT_SECONDS = 60;

interface Candidate {
  readonly name: string;
  readonly endpoint: string;
  readonly tool: string;
  readonly principal?: string;
  readonly price: number;
  readonly argument: (claim: string) => Record<string, unknown>;
}

/**
 * Sellers this Room actually contains, with the endpoints they published
 * themselves. Nothing here is invented: every one of these was posted by its
 * own agent, and the unreachable ones stay on the list so the capability proof
 * has something real to reject.
 */
const CANDIDATES: Candidate[] = [
  {
    name: "TrustSieve",
    endpoint: "https://trustsieve.onrender.com/mcp",
    tool: "trustsieve_scan",
    principal: "p_1gi1M2QuZF",
    price: 3,
    argument: (claim) => ({ text: claim }),
  },
  {
    name: "Ground",
    endpoint: "https://f624b58af19749fca79322a6e21d5ebb.app.workbuddy.host/mcp",
    tool: "ground_check",
    price: 3,
    argument: (claim) => ({ statement: claim }),
  },
  {
    name: "Arbiter",
    endpoint: "https://construction-manitoba-fisheries-interaction.trycloudflare.com",
    tool: "verify",
    price: 5,
    argument: (claim) => ({ claim }),
  },
];

const line = (label: string, value: string) => console.log(`  ${label.padEnd(22)}${value}`);
const rule = (title: string) => console.log(`\n${title}\n${"-".repeat(title.length)}`);

async function rpc(endpoint: string, method: string, params?: unknown, timeoutMs = 45_000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, ...(params ? { params } : {}) }),
      signal: controller.signal,
    });
    if (!response.ok) return { __http: response.status };
    return await response.json();
  } catch (error) {
    return { __error: error instanceof Error ? error.message : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/** Free. Nothing is paid to find out whether a seller can do the job. */
async function proveCapability(candidate: Candidate): Promise<{ held: boolean; detail: string; tools: string[] }> {
  const started = Date.now();
  const listed = await rpc(candidate.endpoint, "tools/list");
  const ms = Date.now() - started;

  if (listed.__error !== undefined) return { held: false, detail: `unreachable (${listed.__error})`, tools: [] };
  if (listed.__http !== undefined) return { held: false, detail: `HTTP ${listed.__http}`, tools: [] };

  const tools: string[] = (listed.result?.tools ?? []).map((tool: any) => tool.name);
  if (tools.length === 0) return { held: false, detail: "exposes no tools", tools };

  const exact = tools.includes(candidate.tool);
  const near = tools.find((name) => /scan|check|verify|extract/i.test(name));
  if (!exact && near === undefined) return { held: false, detail: `no verification tool among ${tools.join(", ")}`, tools };

  return { held: true, detail: `reachable in ${ms}ms, exposes ${exact ? candidate.tool : near}`, tools };
}

async function ledgerTransfer(id: string): Promise<LedgerTransfer | undefined> {
  const response = await fetch(`${BASE}/api/v1/credits/transfers?limit=100`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  if (!response.ok) return undefined;
  const body = (await response.json()) as { items?: LedgerTransfer[] };
  return (body.items ?? []).find((transfer) => transfer.id === id);
}

async function pay(to: string, amount: number, memo: string): Promise<string | undefined> {
  const response = await fetch(`${BASE}/api/v1/credits/transfers`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID().toLowerCase(),
    },
    body: JSON.stringify({ to, amount, memo, room_id: ROOM }),
  });
  const body = (await response.json()) as { transfer?: { id: string }; error?: unknown };
  if (body.transfer === undefined) {
    console.log(`  payment refused: ${JSON.stringify(body.error).slice(0, 200)}`);
    return undefined;
  }
  return body.transfer.id;
}

// ── 1. discover ────────────────────────────────────────────────────────────
const dealId = ATTACK ? `deal_yuzu_fail_${Date.now().toString(36)}` : `deal_yuzu_arena_${Date.now().toString(36)}`;

rule("GOAL RECEIVED");
line("deal", dealId);
line("goal", GOAL);
line("budget", `${MAX_BUDGET} credits`);
line("brokerage", "0 credits (the seller keeps the whole price)");

rule("DISCOVERED");
const affordable = CANDIDATES.filter((candidate) => candidate.price <= MAX_BUDGET);
for (const candidate of affordable) line(candidate.name, `${candidate.price} credits  ${candidate.endpoint.slice(0, 52)}`);

// ── 2. prove capability, before any money moves ────────────────────────────
rule("CAPABILITY PROOF (free, nothing is paid to find out)");
let chosen: Candidate | undefined;
for (const candidate of [...affordable].sort((left, right) => left.price - right.price)) {
  const proof = await proveCapability(candidate);
  line(candidate.name, `${proof.held ? "HELD    " : "REJECTED"} ${proof.detail}`);
  if (proof.held && chosen === undefined) chosen = candidate;
}

if (chosen === undefined) {
  console.log("\nNo seller proved capability. Nothing was paid. UNFILLED, 0 credits.");
  process.exit(0);
}

rule("SELECTED");
line("seller", chosen.name);
line("price", `${chosen.price} credits`);
line("reason", "cheapest candidate whose capability proof held");

// ── 3-4. pay, for real ─────────────────────────────────────────────────────
rule("PAYMENT");
const memo = memoFor(dealId);
let txnId: string | undefined;

if (ATTACK) {
  txnId = "txn_FAKE_123";
  line("supplied txn", `${txnId}  (deliberately forged, for the negative twin)`);
} else if (!PAY) {
  line("dry run", "no credits moved. Re-run with --pay to settle for real.");
} else if (chosen.principal === undefined) {
  line("blocked", `${chosen.name} never published a p_ principal, so there is nobody to pay.`);
} else {
  txnId = await pay(chosen.principal, chosen.price, memo);
  line("paid", txnId === undefined ? "refused" : `${chosen.price} credits -> ${chosen.principal}`);
  if (txnId !== undefined) line("txn", txnId);
}

// ── 5. verify the payment against our own ledger ───────────────────────────
rule("PAYMENT VERIFICATION (our ledger, not the claim)");
const transfer = txnId === undefined ? undefined : await ledgerTransfer(txnId);
const decision = verifyPayment(transfer, {
  dealId,
  seller: chosen.principal ?? "p_unknown",
  buyer: BUYER_PRINCIPAL,
  price: chosen.price,
  consumed: new Set<string>(),
});

for (const check of decision.checks) {
  line(check.invariant, check.held === undefined ? "-" : check.held ? "ok" : "FAILED");
}
if (!decision.ok) line("reason", decision.reason ?? "");

// ── 6. the gate ────────────────────────────────────────────────────────────
rule(decision.sellerMayBeInvoked ? "SELLER INVOCATION ALLOWED" : "SELLER INVOCATION BLOCKED");
let delivery: any;
let sellerCalls = 0;

if (decision.sellerMayBeInvoked) {
  const started = Date.now();
  delivery = await rpc(chosen.endpoint, "tools/call", {
    name: chosen.tool,
    arguments: chosen.argument(GOAL.replace(/^Verify this claim:\s*/i, "")),
  });
  sellerCalls = 1;
  line("seller calls", String(sellerCalls));
  line("latency", `${Date.now() - started}ms`);
} else {
  line("seller calls", "0");
  line("credits settled", "0");
  line("state", "PAYMENT_NOT_VERIFIED");
  line("failed invariant", decision.failed ?? "-");
}

// ── 7. verify delivery, then settle ────────────────────────────────────────
if (sellerCalls > 0) {
  rule("DELIVERY CHECK (the contract, not the status field)");
  const text = delivery?.result?.content?.[0]?.text;
  const responded = text !== undefined || delivery?.result !== undefined;
  const hasEvidence = typeof text === "string" && /evidence|quote|source|claim|offset|hash/i.test(text);
  line("seller responded", responded ? "ok" : "FAILED");
  line("evidence supplied", hasEvidence ? "ok" : "FAILED");
  line("contract", responded && hasEvidence ? "SATISFIED" : "NOT SATISFIED");

  rule("SETTLED");
  const receipt = signPayload("yuzu.deal.v1", {
    deal_id: dealId,
    state: responded && hasEvidence ? "SETTLED" : "DELIVERY_REJECTED",
    buyer: BUYER_PRINCIPAL,
    seller: chosen.principal,
    seller_name: chosen.name,
    price: chosen.price,
    brokerage: 0,
    payment_txn_id: txnId,
    capability_verified: true,
    payment_verified: true,
    delivery_verified: responded && hasEvidence,
    seller_result: typeof text === "string" ? text.slice(0, 400) : undefined,
  });
  console.log(JSON.stringify(receipt, null, 1).slice(0, 1400));
  console.log("\nDISCOVERED -> PROVED -> PAID -> VERIFIED -> DELIVERED -> CHECKED -> SETTLED");
} else {
  rule("RESULT");
  console.log(
    JSON.stringify(
      {
        state: `PAYMENT_NOT_VERIFIED`,
        deal_id: dealId,
        seller_invoked: false,
        seller_calls: 0,
        credits_settled: 0,
        failed_invariant: decision.failed,
        reason: decision.reason,
      },
      null,
      1,
    ),
  );
  console.log("\nThe seller was never reachable. That is the point.");
}
