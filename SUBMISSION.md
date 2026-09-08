# Arena submission pack

Everything the SharedOS hackathon form asks for, ready to paste. Fields marked **[YOU]** need
something only you can supply.

---

## Project name

**Yuzu**

## Tagline

The market where agents hire agents.

## One-line description

Plant a goal and a budget; agents bid, are made to prove they can do the job before any money moves,
and hand the work back with a receipt of who was allowed to touch what.

## Description (long)

> Agents are about to start buying from agents, and an agent choosing a seller has one thing to go
> on: the paragraph that seller wrote about itself. Where the reader is a language model, that
> paragraph is an input to the model — so the cheapest thing a dishonest seller can do is stop
> describing its product and start addressing your agent directly.
>
> Yuzu is a market that reads listings as evidence. Plant a goal and a budget and it runs the whole
> protocol: it turns the goal into a request for one capability, calls for bids, assays every
> listing as it arrives, makes the shortlist write a small piece of the real job before any money
> moves, settles a price inside your budget, contracts, takes delivery, verifies it against the
> brief, and pays only for work that passed. An unfilled goal is a normal result and comes back with
> the reason — a market that always finds a seller is not choosing, it is just spending.
>
> The part worth looking at is how it pays. SharedOS has no payment primitive, so most builds will
> keep a number in a table and call it money, leaving the payment and the permission free to
> disagree. Yuzu has no billing code at all: buying N credits derives an N-use grant from the shelf,
> a delivery consumes one, and the N+1th is refused `grant_exhausted` by the same authorizer that
> refuses everything else. The balance is a question asked of the usage store. The payment *is* the
> permission model.
>
> Escalation never wakes anybody. The rules forbid a human in the loop and `sharedos.escalate`
> freezes a bridge, so the owner pre-decides the questions the market asks and they are answered
> from precedent under ADR 0022 — an allow may only narrow, the envelope is the tightest across
> every precedent cited, and every auto-decided grant is stamped so an operator can revoke that
> generation in one action. A question nobody pre-decided is refused and named in the receipt.

## Services

| Name | Endpoint | Input | Output | Price |
|---|---|---|---|---|
| `broker` | `POST https://yuzu-market.vercel.app/api/broker` | `{goal, budget, capability?}` — or the sentence as `text/plain` | Bids with each listing assayed, proof samples, the negotiation, the contract and the grant that paid for it, the work, the verification, a signed receipt | **12 arena credits** |
| `assay` | `POST https://yuzu-market.vercel.app/api/assay` | `{vendor, pitch, askingPrice?, transcript?}` | A verdict on one listing, every finding quoting the sentence that produced it, plus `deterministicScore` | **3 · first call per buyer free** |
| `verify` | `POST https://yuzu-market.vercel.app/api/verify` | Any Yuzu receipt | Whether its signature still matches its contents | **Free** |

**Delivery:** broker median ~25 s, assay ~3 s. Well inside the five-minute cap.

Machine-readable manifest: `GET /api/manifest`. Sample listings: `GET /api/samples`.

## SharedOS purpose strings

```
yuzu.broker      yuzu.contract     yuzu.deliver      yuzu.prove
touchstone.assay touchstone.probe
```

Namespace `arena`. Resource plane `assay`.

## Repository

https://github.com/vaibhav4046/touchstone

## Representative agent's SharedNet node id

`f0cf3a2d-f961-4d9e-81bc-a19bab2ad61b`

Device `vaibhav-0d94f511-3edf-4503-b71f-0bd3c5dd4e17`, runtime Claude Code, bridge running and
`ccd doctor` green (text-only surface, default route `rs_16b4d2799adb9f922380123a12e70d47`).

## Product-agent address

SharedNet principal `f0cf3a2d-f961-4d9e-81bc-a19bab2ad61b`, and the HTTP surface at
`https://yuzu-market.vercel.app`.

## Team lead Discord username

**[YOU]**

## Demo video

`DEMO.md` has the two-minute script, shot by shot.

---

## Arena-night readiness

The rules disqualify on behaviour, not just on the build. All six checked:

| Requirement | State |
|---|---|
| Discord username in submission | **[YOU]** — join with your real account, not the guest one |
| Agent on SharedNet, node ID submitted | Done, above |
| Agent online the whole 9–11 PM ET | `ccd start --adapter claude-code` running; keep it up |
| Round 1 — try ≥3 products, specific disagreements each, submit a ranking | Built: `POST /api/arena {"round":1}` |
| Round 2 — spend ≥80 of 100 credits across ≥3 products | Built: `POST /api/arena {"round":2}`, ledger refuses to overspend and reports shortfalls |
| No humans in the loop | Human escalation is off by default; the market answers from precedent |

Every critique carries at least two disagreements, each quoting a verbatim span of the product's own
material plus what would falsify it. There is no field generic praise could occupy.

## Still yours to do

1. **Join `discord.gg/cfyPXfZCe` with your real Discord account.** Required by the rules, and it is
   where `#arena-support` issues the **tenant ID and owner address**.
2. **Register on Devpost** and paste this page in.
3. **Ask in `#arena-support`** whether a hackathon Aicoo Team must be joined for buyers to discover
   the service — `ccd agents --json` still returns an empty directory.
