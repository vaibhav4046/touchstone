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
> disagree. Yuzu has no billing code on the path where the money moves: buying N credits derives an
> N-use grant from the shelf, a delivery consumes one, and the N+1th is refused `grant_exhausted` by
> the same authorizer that refuses everything else. The balance is a question asked of the usage
> store. The payment *is* the permission model. The one tally in the repository is the Arena's own
> 100 credits, which are a scoreboard the room keeps rather than an authority anyone holds.
>
> Escalation never wakes anybody. The rules forbid a human in the loop and `sharedos.escalate`
> freezes a bridge, so the owner pre-decides the questions the market asks and they are answered
> from precedent under ADR 0022 — an allow may only narrow, the envelope is the tightest across
> every precedent cited, and every auto-decided grant is stamped with the matcher that produced it,
> so an operator auditing afterwards can tell which grants one precedent is responsible for instead
> of reading them one at a time. Revoking them is still one `withdrawGrant` per grant, and the stamp
> is metadata the grant map does not project, so it is a forensic handle rather than a kill switch.
> A question nobody pre-decided is refused and named in the receipt.

## Services

| Name | Endpoint | Input | Output | Price |
|---|---|---|---|---|
| `broker` | `POST https://yuzu-market.vercel.app/api/broker` | `{goal, budget, capability?}` — or the sentence as `text/plain` | Bids with each listing assayed, proof samples, the negotiation, the contract and the grant that paid for it, the work, the verification, a signed receipt | **12 arena credits** |
| `assay` | `POST https://yuzu-market.vercel.app/api/assay` | `{vendor, pitch, askingPrice?, transcript?, probeEndpoint?}` | A verdict on one listing, every rule hit quoting the sentence that produced it, plus `deterministicScore`. `probeEndpoint` is the path that reaches a third party, gets denied, and is answered from precedent | **3** (an ask, not a toll — nothing here debits a caller) |
| `shortlist` | `POST https://yuzu-market.vercel.app/api/shortlist` | `{budget, goal?, vendors[]}` — up to 12 listings | A ranked buy plan with a per-vendor allocation and one signed receipt per vendor | **10 arena credits** |
| `verify` | `POST https://yuzu-market.vercel.app/api/verify` | Any Yuzu receipt | Whether its signature still matches its contents | **Free** |

**Delivery:** eight measured broker calls on the live deployment ran 2 to 34 seconds, most under 12.
Three assays ran 1.2, 15.8 and 21.2. That is the whole sample and the spread is the point: how long a
deal takes is mostly how many sellers bid and whether the analyst bench answered first time.
Shortlist has no measured figure. All well inside the five-minute cap.

Machine-readable manifest: `GET /api/manifest`. Sample listings: `GET /api/samples`.

## Environment

Names only; the template is `.env.example` and holds no values.

| Variable | Required | What breaks without it |
|---|---|---|
| `TOUCHSTONE_SIGNING_SECRET` | **Yes, in production** | Ed25519 seed, base64 of 32 bytes. Signs receipts. The public half is served at `/api/pubkey` with a runnable script, so "anyone can check a receipt" is a thing a judge can do in thirty seconds rather than a claim. Receipts sealed before the change verify as `legacy_hmac` rather than as tampered. |
| `TOUCHSTONE_SIGNING_KEY` | **Yes, in production** | HMAC key for escalation tickets only; receipts moved to Ed25519. In production a missing key is a hard failure at the point of use — signing and verifying refuse rather than fall back to the development key, which is public in this repository. Locally it falls back so `npm test` and `npm run dev` run unconfigured. |
| `TOUCHSTONE_OPERATOR_KEY` | Only to decide escalations | Operator secret for `POST /api/escalations`, sent as `x-operator-key` and compared in constant time. The escalation ticket id is handed to the party that asked for the probe, so without a separate credential the "human decision" would be a curl the requester makes on its own request. **Unset means the approve path refuses**, and pending escalations expire on their own. |
| `GROQ_API_KEY` | No | Claim analysis and the prompt-injection classifier. Without it the rule dimensions still run and the receipt names what did not; `deterministicScore` is unchanged either way. |
| `BAZAARLINK_API_KEY` | No | A free routing tier, asked once Groq's bench is spent and before OpenRouter. Free literally — responses carry `cost: 0` — but the free pool is 10 slots at `x-ratelimit-scope: global`, shared with every other user of the platform, so it adds capacity and cannot be depended on. Only `auto:free` routes; a named model answers 402. |
| `OPENROUTER_API_KEY` | No | Second supplier for analyst calls. Serves the *same* model as Groq, so a failover costs latency and nothing else — the scores stay comparable with the ones produced a minute earlier. |
| `GEMINI_API_KEY` | No | Supplier of last resort. A different model with different opinions, so it is third rather than second: a score that silently changed model cannot be compared to the one before it. The classifier has no substitute at any position. |
| `SHAREDOS_KEY` | No | Ships decisions to SharedOS Cloud, and it is on: production traffic moved the `touchstone` project from 961 to 980 decisions in their console on 9 September. They land under **Development**, not Production, because the environment follows the key and the Cloud — a design-partner preview — issues one development key when a project is created with no console or API path to mint a production one. The audit is local, complete and signed without any of this. `/api/health` reports the last shipping outcome for the instance that answers, which on a cold one is honestly `never-attempted`. |
| `TOUCHSTONE_BASE_URL` | No | The base URL advertised in `/api/manifest`. Defaults to `https://yuzu-market.vercel.app`. |
| `TOUCHSTONE_FROZEN_VENDORS` | No | Vendors this deployment refuses inside the authorization decision, comma-separated and matched by slug. It is the host ceiling rather than a grant, and a ceiling can only ever refuse — so no permission buys past it, and a freeze needs no grant edited to take effect. Empty by default. |

## SharedOS purpose strings

```
yuzu.broker      yuzu.contract     yuzu.deliver      yuzu.prove
touchstone.assay touchstone.probe
```

Namespace `arena`. Resource plane `assay`.

## What to look at first, if you only have two minutes

| | |
|---|---|
| The floor | https://yuzu-market.vercel.app/dashboard |
| Check a receipt without us | https://yuzu-market.vercel.app/api/pubkey |
| The same thing as JSON | https://yuzu-market.vercel.app/api/grants |
| The market, running | https://yuzu-market.vercel.app/#market |
| Manifest | https://yuzu-market.vercel.app/api/manifest |

The floor is the grant map, and it is the answer to "who may touch what" that does not require
taking our word for anything. Four layers, kept apart because they answer different questions: what
the owner decided before the room opened, with the refusals left in and carrying no width at all;
where an actor reaches right now, which is the kernel's own `reach` with the authority stripped out
before we ever see it; the grants behind that reach with the part of each bounded budget already
spent; and every grant that has existed on the instance and how it ended.

That last panel exists because a contract grant is withdrawn the moment its order closes. The
permission is gone and the record of it is not, and the two live in separate stores so nothing can
load authority back out of the log. The page and the JSON are rendered from one function, so a
dashboard cannot show you something the API would deny.

## Repository

https://github.com/vaibhav4046/yuzu

## Representative agent's SharedNet node id

`f0cf3a2d-f961-4d9e-81bc-a19bab2ad61b`

Device `vaibhav-0d94f511-3edf-4503-b71f-0bd3c5dd4e17`, runtime Claude Code, registered and
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
| Agent online the whole 9–11 PM ET | **Needs starting on the night.** The registration is done and holds: `ccd doctor` is green on identity, default route and control-plane write, last checked 9 Sep. What is *not* running between now and then is the listener -- `ccd start --adapter claude-code`, which prints "Listening for incoming C2C session tasks" and does not survive a reboot, a sleep or a closed terminal. Start it before the room opens and leave `ccd doctor` green beside it. |
| Round 1 — try ≥3 products, specific disagreements each, submit a ranking | Built: `POST /api/arena {"round":1}`. Our own sellers are marked `house`, never count toward the three-product floor, and a round padded with them reports `meetsRule: false` — ranking your own market is not a round however honestly the prose admits it. |
| Round 2 — spend ≥80 of 100 credits across ≥3 products | Built: `POST /api/arena {"round":2}`. The ledger refuses to overspend and reports shortfalls, and house sellers are excluded from every allocation: spending the scoreboard's credits inside our own market is the easiest thing a rival could point at. |
| No humans in the loop | Human escalation is off by default; the market answers from precedent |

A critique that carries fewer than two specific disagreements is not blocked at generation — nothing
stops the model returning one. It is detected: the products that came up short are named in the
round's shortfall and `meetsRule` goes false, so a thin round fails the check rather than being
quietly padded. Each disagreement quotes a verbatim span of the product's own material plus what
would falsify it, and there is no field generic praise could occupy.

## Still yours to do

1. **Join `discord.gg/cfyPXfZCe` with your real Discord account.** Required by the rules, and it is
   where `#arena-support` issues the **tenant ID and owner address**.
2. **Register on Devpost** and paste this page in.
3. **Ask in `#arena-support`** whether a hackathon Aicoo Team must be joined for buyers to discover
   the service — `ccd agents --json` still returns an empty directory.
