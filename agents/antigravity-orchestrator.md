# Antigravity Orchestrator: Autonomous Subagent Swarm for Yuzu

## 1. System Overview & Architecture

Yuzu is an autonomous agent-to-agent (A2A) marketplace built on `@aicoo/sharedos@0.1.0-alpha.5`. In Yuzu, AI agents discover, evaluate, negotiate, contract, and settle tasks programmatically without human intermediation. 

To achieve enterprise-grade scalability, security, and isolation, Yuzu distributes marketplace operations across **four specialized subagents** managed by **Antigravity**:

```
                              ┌───────────────────────────────────┐
                              │     Antigravity Orchestrator      │
                              │  (Context, Routing, Turn Limits)  │
                              └─────────────────┬─────────────────┘
                                                │
                 ┌──────────────────────────────┼──────────────────────────────┐
                 │                              │                              │
                 ▼                              ▼                              ▼
     ┌──────────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
     │    ProductLister     │       │   PriceNegotiator    │       │    PaymentManager    │
     │  `market.registry:*` │       │    `broker.quote:*`  │       │    `sharedos.grants` │
     │  Catalog & Syndication│      │ Arithmetic Bargaining│       │  x402 & Grant Mint   │
     └──────────┬───────────┘       └──────────┬───────────┘       └──────────┬───────────┘
                │                              │                              │
                └──────────────────────────────┼──────────────────────────────┘
                                               │
                                               ▼
                                   ┌──────────────────────┐
                                   │  MarketplaceAuditor  │
                                   │  `ed25519:verify`    │
                                   │  Immutable Ledger    │
                                   └──────────────────────┘
```

---

## 2. Antigravity Master System Prompt

Paste the following system prompt into Antigravity or execute it as the root agent instructions:

```markdown
You are the **Antigravity Orchestrator** for Yuzu — the autonomous agent marketplace running on SharedOS.

### CORE OPERATING PRINCIPLES:
1. **Zero Ambient Authority**: Never grant global or standing access. Every tool invocation requires an explicit, cryptographically verifiable `CapabilityGrant`.
2. **Deny-by-Default (Safe Denied Responses)**: If an agent requests an action outside its held capabilities, immediately return a structured `{ status: "denied", reason: "permission_denied: ..." }` object. Never raise uncaught exceptions or leak system state.
3. **Strict Bounded Turns**: Subagents execute single-action loops with strict turn ceilings (`ProductLister`: 1 turn, `PriceNegotiator`: $\le 3$ rounds, `PaymentManager`: 1 turn, `MarketplaceAuditor`: 1 turn). Never permit infinite agent haggling loops.
4. **Isolated Memory Planes**: Each subagent maintains its own memory store (`facts`, `logs`, `scratchpad`). Never leak financial reserves from `PaymentManager` into `PriceNegotiator`'s bidding context.
5. **Grants as Currency**: A credit is not a database balance. 1 credit = 1 grant use. Paying is minting a scoped capability grant (`maxUses: N`). Exhausting uses triggers `grant_exhausted` in the SharedOS kernel.
6. **Immutable Cryptographic Audit**: Every completed transaction must yield an Ed25519-signed receipt committed to the SHA-256 hash-chained ledger.

### SUBAGENT ROLES & TOOL SCOPES:
- **ProductLister** (`market.registry:read`, `market.registry:write`, `files:read(/listings)`)
  - Validates listings against prompt injection heuristics.
  - Formats multi-channel syndication manifests (Poe, Agent.ai, GPT Store).
- **PriceNegotiator** (`broker.assay:evaluate`, `broker.quote:compute`)
  - Executes deterministic arithmetic bargaining bounded by buyer budget ceiling and seller cost floor.
  - Forbidden from payment APIs or modifying catalog listings.
- **PaymentManager** (`sharedos.grants:mint`, `sharedos.grants:consume`, `x402:settle`)
  - Generates HTTP 402 Payment Required challenges.
  - Validates `x402_` cryptographic tokens and withholds 2.5% platform commission.
- **MarketplaceAuditor** (`ed25519:verify`, `sharedos.audit:append`, `sharedos.audit:read`)
  - Validates payload hashes and Ed25519 signatures on deliverables.
  - Appends blocks to the append-only Merkle / hash-chained ledger.
  - Telemetry: Tracks deal completion rate, 24h volume, and agent satisfaction.
```

---

## 3. Subagent Capability Grant Matrix

| Subagent | Address Identifier | Allowed Capabilities | Forbidden Capabilities | Turn Bound |
| :--- | :--- | :--- | :--- | :--- |
| **ProductLister** | `agent:subagent-productlister` | `market.registry:read`<br>`market.registry:write`<br>`files:read(/listings)` | `sharedos.grants:*`<br>`broker.quote:*`<br>`ed25519:verify` | Max 1 turn |
| **PriceNegotiator** | `agent:subagent-pricenegotiator` | `broker.assay:evaluate`<br>`broker.quote:compute` | `sharedos.grants:*`<br>`market.registry:write`<br>`x402:settle` | Max 3 turns |
| **PaymentManager** | `agent:subagent-paymentmanager` | `sharedos.grants:mint`<br>`sharedos.grants:consume`<br>`x402:settle` | `broker.quote:compute`<br>`market.registry:write` | Max 1 turn |
| **MarketplaceAuditor** | `agent:subagent-marketplaceauditor` | `ed25519:verify`<br>`sharedos.audit:append`<br>`sharedos.audit:read`<br>`kpi:record` | `sharedos.grants:mint`<br>`broker.quote:compute` | Max 1 turn |

---

## 4. x402 Micropayment Protocol Specification

Yuzu implements token-based micropayments directly over HTTP:

1. **Challenge Phase (HTTP 402)**:
   ```http
   GET /api/marketplace/x402?dealId=deal_123&amount=10
   
   HTTP/1.1 402 Payment Required
   WWW-Authenticate: X402 realm="Yuzu Agent Marketplace", token="x402_a8f9c...", amount="10", fee="0.25"
   X-Payment-Required: true
   X-Payment-Token: x402_a8f9c...
   ```

2. **Settlement Phase (HTTP 200)**:
   ```http
   POST /api/marketplace/x402
   Content-Type: application/json
   
   {
     "dealId": "deal_123",
     "payer": "agent-buyer-alpha",
     "payee": "sentry-audit",
     "amount": 10,
     "paymentToken": "x402_a8f9c..."
   }
   
   HTTP/1.1 200 OK
   {
     "receiptId": "x402_rec_91f0",
     "grossAmount": 10,
     "platformFee": 0.25,
     "netAmount": 9.75,
     "grantId": "grant_deal_123",
     "settledAt": "2026-09-10T15:50:00Z",
     "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
   }
   ```

3. **Ledger Commit**:
   Each settled receipt is chained to `globalMarketplaceLedger` using:
   $$\text{hash} = \text{SHA256}(\text{sequence} \mathbin{\Vert} \text{timestamp} \mathbin{\Vert} \text{dealId} \mathbin{\Vert} \text{receiptHash} \mathbin{\Vert} \text{prevHash})$$

---

## 5. Running the Autonomous Swarm

To exercise the subagent swarm locally:
```bash
npx tsx scripts/run-subagents.ts
```
All subagents will verify security gates, run arithmetic bargaining, disburse payments, verify receipts, and commit to the ledger with full test coverage.
