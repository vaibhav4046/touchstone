# Yuzu — SharedOS competitive strategy

Snapshot: 2026-09-11. Re-run when the project gallery or SharedNet room reveals actual products.

## Current evidence quality

The public Devpost project gallery is **not published yet**. The participant counter has been observed around the low/mid 60s, but registered participants are not the same as eligible finished products.

Therefore there is currently **no honest competitor-by-name ranking**.

Do not invent one.

The moment the gallery / Arena service directory becomes visible, replace the archetype matrix below with real products and real calls.

## Current win probability

These are preliminary probabilities, not promises. They are intentionally discounted because the competing services are still hidden.

| Prize | Preliminary Yuzu probability | Why |
|---|---:|---|
| Agents' Choice | 18% | Strong memorable mechanism and adversarial proof, but the product is more complex than a single-purpose tool and agents may rank immediately useful task services higher. |
| Top Earner | 22% | 3/10/12-credit price ladder is easy to buy, but revenue requires other agents to understand why they need a market/assay while already inside an Arena marketplace. |
| Judges' Pick | 38% | This is currently the best fit: grants are product mechanics, payment is coupled to bounded authority, refusals and precedent matter, receipts expose audit evidence. |
| Any prize | 48% | Categories are correlated; this is not 1-(loss probabilities multiplied). Lack of competitor data prevents tighter calibration. |

Confidence: **low-to-medium** until actual competitors are visible.

## Current rank

**Not defensibly rankable yet.** Devpost has not published the project gallery.

Working planning assumption only: if 10–20 genuinely eligible, callable products reach the Arena, Yuzu currently looks like a plausible **top-3 Judges' Pick candidate** and **top-5 overall candidate**. This is a scenario, not an observed rank.

## Why Yuzu is stronger than the proposed "VIVA Finish" pivot

The proposed VIVA direction is goal → plan → bounded execution → verification → receipt.

Yuzu already contains the harder and more Arena-native version of that:

`goal → discover sellers → assay → proof challenge → negotiate → contract grant → deliver → verify → settle → signed receipt`

Replacing this with a generic bounded-execution service would throw away:

- proof-before-payment;
- market price discovery;
- the 3/10/12-credit service ladder;
- Ed25519 receipts;
- assay/shortlist products;
- hostile-listing defense;
- explicit verification-before-settlement;
- the core "paying is minting" SharedOS mechanic.

Decision: **keep Yuzu unless real competitor evidence shows the market/broker concept is dominated.**

## Winning Yuzu

**Yuzu is the market where an agent can hire an agent it has never met, make it prove itself before money moves, buy only bounded authority, and independently verify what happened afterward.**

Short Arena form:

**Give Yuzu a job and budget. Get back the work plus proof of who was allowed to do what.**

## What another agent buys

### `yuzu.broker`

Input: goal + budget + optional capability.

Output: seller candidates, listing assays, proof samples, negotiation, bounded contract grant, delivered artifact, verification, settlement and signed receipt.

Price: **12 credits**.

Target delivery: currently configured below the Arena five-minute ceiling; live latency must be re-measured on current master before Arena.

Why it pays: it converts "this seller says it can" into an evidence-backed purchase and result.

### `yuzu.assay`

Input: one seller listing, optional price/transcript/probe.

Output: verdict + published-dimension score + deterministic score + quote-backed findings + signed evidence.

Price: **3 credits**.

Why it pays: low-friction pre-purchase defense against self-authored agent marketing/prompt steering.

### `yuzu.shortlist`

Input: up to 12 candidate listings + optional goal/budget.

Output: evidence-ranked shortlist and signed receipts.

Price: **10 credits**.

Why it pays: fast choice when the buyer already has several sellers.

## SharedOS proof

### Product roles

Yuzu conceptually separates market stages instead of giving one omnipotent model ambient authority:

- buyer/broker stage: interprets the goal and coordinates a bounded market turn;
- assay/proof stage: treats seller material as untrusted evidence;
- contract/delivery stage: only invokes work under a contract-specific grant;
- verifier stage: evaluates delivery before settlement.

### Purpose strings currently declared

- `yuzu.broker`
- `yuzu.prove`
- `yuzu.contract`
- `yuzu.deliver`
- `touchstone.assay`
- `touchstone.probe`

### Representative agent

`f0cf3a2d-f961-4d9e-81bc-a19bab2ad61b`

### Deliberately absent authority

The Arena service card states that the product is not granted:

- repository access;
- caller credentials;
- unbounded fetch;
- live human escalation during an Arena run.

### Denial / escalation story

The strongest Judges' Pick demonstration is not a happy path. Show a requested probe/action that is outside the current authority, then show the kernel refuse it. Where an owner decision was pre-recorded under precedent, an auto-decision may only narrow authority. Where no valid precedent exists, the operation stays refused.

Do not fake a live human escalation because Arena rules forbid a human in the loop.

### Audit evidence

The signed receipt should expose:

- stages executed;
- kernel decisions;
- grant/purpose involved;
- consumed uses;
- denied operations;
- verification result;
- settlement;
- what was not checked.

Then modify a signed field and demonstrate offline verification failing.

## Competitor matrix — waiting for real products

Do not assign project names until observed.

| Threat archetype | Why it can beat Yuzu | Agents' Choice threat | Top Earner threat | Judges' Pick threat | Yuzu response |
|---|---|---:|---:|---:|---|
| Research / fact verification service | Extremely easy to understand and useful mid-task | High | High | Medium | Lead with assay as trust-before-action, then broker for actual completion |
| Code review / bug-fix service | Agents constantly need it and output is tangible | High | High | Medium | Yuzu must demonstrate useful artifact delivery, not only market mechanics |
| Persistent memory service | Repeat-call value, broad across agents | High | High | Medium | Emphasize that Yuzu is transactional trust, not generic storage |
| Scheduling / cross-agent coordination | SharedOS-native permissions can be obvious | Medium | Medium | High | Make grant/refusal/audit proof more visual and simpler than theirs |
| Narrow premium transformation service | One-sentence value, fast, reliable | High | High | Low/Medium | Yuzu's complexity must not slow comprehension; present one job, not six APIs |
| Security / permission auditor | Direct overlap with Judges' Pick criteria | Medium | Medium | High | Yuzu has payment=permission + execution proof; show the full lifecycle |

Replace this table with observed competitors as soon as possible.

## Why Yuzu loses today

1. **Competitors are unknown.** No defensible #1 claim exists until gallery/room data is available.
2. **The product is conceptually dense.** "Agent market + assay + proof + negotiation + grants + signatures" can lose to a simpler service in a ten-second evaluation.
3. **Top Earner value can feel meta.** Buyers are already in a marketplace; Yuzu must show why using a market inside the Arena gives a better result than directly buying one service.
4. **Operational eligibility is dangerous.** The Devpost rule requires >=3 external trials + specific disagreements + ranking, then >=80 credits across >=3 products. Missing one invalidates the entry.
5. **Public event sources currently conflict on the Arena time.** Resolve this with organizers before the no-human window; otherwise a perfect agent can simply show up at the wrong time.

## Delete / keep / build

### Delete / stop doing

- Stop the VIVA rebrand/pivot for this hackathon.
- Stop adding broad "AI operating system" language.
- Stop adding decorative features that do not improve an Arena purchase or SharedOS proof.
- Stop quoting stale metrics across different docs.
- Stop using "10/10" or "definitely wins" language as evidence.

### Keep

- Yuzu name and one-line market thesis.
- `yuzu.broker` at 12 credits until actual market evidence says the price is wrong.
- low-friction `yuzu.assay` at 3.
- `yuzu.shortlist` at 10.
- free verify/grant proof surfaces.
- payment-as-grant-use architecture.
- proof-before-negotiation.
- verification-before-settlement.
- signed receipts.
- explicit refusal and `notChecked` reporting.
- existing Round 1/2 compliance code.

### Build / validate before Arena

- one-click or one-call service discovery from the real SharedNet room;
- actual calls against >=3 non-house products in rehearsal once available;
- production test of `yuzu.broker` from a clean external caller;
- current-master metrics freeze;
- representative listener survival/health rehearsal;
- current Arena schedule resolution in Discord;
- competitor matrix from actual listings as soon as visible.

## Single best demo

The demo should prove one transaction:

1. buyer says: "I need a competitor brief for a coffee launch; budget 20";
2. Yuzu discovers sellers;
3. one hostile seller tries to steer the evaluator;
4. Yuzu flags the listing;
5. candidates produce proof samples before payment;
6. Yuzu negotiates a bounded price;
7. paying mints the contract-specific grant;
8. the seller delivers;
9. verifier checks the result;
10. accepted work settles, rejected work would not;
11. Yuzu displays the signed receipt;
12. mutate one receipt field and offline verification fails.

The audience should leave with two sentences:

**Agents should not have to trust what another agent says about itself.**

**In Yuzu, the money and the permission are the same bounded thing.**

## Next three actions

1. **Eligibility hardening:** freeze the exact organizer-confirmed Arena schedule and verify the representative remains online/reachable for the full window.
2. **External rehearsal:** the moment real competitors/services become visible, call at least three from the representative, generate specific disagreements, rank them, and rehearse the 90-credit / four-seller purchase plan without self-products.
3. **Current-master proof pack:** run tests/typecheck/build and production broker/assay samples, then synchronize every public numeric claim from one dated evidence file.

Do these before adding another feature.