# Yuzu — SharedOS Arena runbook

Last researched: 2026-09-11 UTC/BST transition window.

This file exists because eligibility can be lost by representative behavior even when the product is excellent.

## Current schedule: resolve the conflict before Arena

There is currently a public-source conflict:

- Latest SharedOS event page: `https://www.sharedos.ai/weekly-hackathon` says the event is Sep 11–13, submissions close Sep 13 at 9:00 AM ET, and Arena is Sep 13 at 9:00–11:00 AM ET.
- Devpost rules: `https://shared-os-hackathon.devpost.com/rules` shows Sep 11–13 in the header but still contains an older rule sentence saying the representative must be online 9:00–11:00 PM ET.

Do not guess which time controls eligibility. Before Arena, check the latest Discord announcement / `#arena-support` and the live SharedOS event page. The organizer announcement is the operational source of truth. Record the resolved window below before the no-human period begins.

Resolved Arena window: **UNRESOLVED — VERIFY BEFORE ARENA**

Do not hardcode an Arena scheduler until this is resolved.

## Current official Discord

The latest SharedOS event page currently links:

`https://discord.gg/bTQVRNhd9`

Invites can rotate. Prefer the Discord link on the live official event page over a copied invite in old repository text.

## Submission deadline

Latest SharedOS event page currently states:

**Sep 13, 2026 at 9:00 AM ET**

Verify again before submission because the event has already been rescheduled once.

## Disqualification gates

Devpost says the submission is invalid if any required gate is missed.

Before Arena:

- [ ] Discord joined with the team lead's real account.
- [ ] Discord username present in submission.
- [ ] representative personal agent registered on SharedNet.
- [ ] node ID present in submission.
- [ ] submission completed before the current deadline.
- [ ] product satisfies current What to Build rules.
- [ ] current Arena window confirmed from organizer announcement.
- [ ] representative listener started early and verified reachable.
- [ ] product endpoints verified reachable from outside local machine.
- [ ] current test suite run and result frozen below.
- [ ] at least one current production service call measured end-to-end.

During Arena:

- [ ] representative online for entire required window.
- [ ] no human messages/rankings/purchases/deliveries/fixes.
- [ ] Round 1 tries >=3 distinct external products.
- [ ] Round 1 produces >=1 specific disagreement for each product tried.
- [ ] Round 1 submits ranking.
- [ ] Round 2 spends >=80/100 credits.
- [ ] Round 2 spends across >=3 distinct external products.
- [ ] no self-purchase / house service counts toward requirements.
- [ ] spend never exceeds 100.
- [ ] signed spend records preserved and carried between serverless calls.

## Representative identity

SharedNet node from current submission pack:

`f0cf3a2d-f961-4d9e-81bc-a19bab2ad61b`

Re-verify with the actual SharedNet client before Arena.

## Pre-Arena frozen evidence

Fill these from current master immediately before Arena. Do not copy historical counts.

Commit SHA: **TODO**

Test result: **TODO**

Test files: **TODO**

Typecheck: **TODO**

Build: **TODO**

Live `yuzu.broker` sample count: **TODO**

Observed latency range: **TODO**

Production health: **TODO**

SharedNet listener health: **TODO**

## Round 1 execution

The current code exposes `POST /api/arena` with round 1 and candidate data. It intentionally distinguishes external products from house products and reports `meetsRule: false` when the external-product requirement is not satisfied.

Candidate record should contain real room data, not invented competitors:

```json
{
  "round": 1,
  "candidates": [
    {
      "name": "real product name",
      "pitch": "real listing/pitch",
      "endpoint": "https://real-service.example/api",
      "price": 8
    }
  ]
}
```

Preserve the returned ranking, critiques and specific disagreements.

A disagreement should be falsifiable. Good shape:

> Product says X. In our trial Y happened. Therefore I disagree with X as currently stated. A successful call under condition Z would change that conclusion.

Bad shape:

> Great idea, but could be better.

## Round 2 execution

The current ledger constants are:

- budget: 100
- minimum spend: 80
- minimum distinct sellers: 3
- target spend: 90
- intended spread: up to 4 products

The target is deliberately above the 80-credit floor to leave room for one refused/failed purchase.

Keep every `spendRecord` returned by the Arena route. Pass prior signed records back on a later call so a different serverless instance can reconstruct the tally.

Do not rely on process memory as the durable Arena ledger.

## Yuzu services to sell

| Service | Price | Best buyer moment |
|---|---:|---|
| `yuzu.broker` | 12 | Buyer needs another agent to actually do work and wants proof before payment |
| `yuzu.assay` | 3 | Buyer is about to trust another agent's self-authored listing |
| `yuzu.shortlist` | 10 | Buyer has several sellers and needs an evidence-ranked choice |
| `yuzu.verify` | 0 | Buyer wants to independently check a receipt |
| `yuzu.grants` | 0 | Buyer/judge wants to inspect authority |
| `yuzu.sellers` | 0 | Another product wants to enter Yuzu's market |

Do not artificially inflate purchase demand. Agents' voluntary purchases are the result.

## Emergency behavior during no-human period

Allowed: autonomous retries/fallbacks that were built before Arena and respect current authority.

Not allowed: asking the owner what to do, manually changing a ranking, manually restarting a failed step, manually approving spending, editing competitor data, or manually repairing the agent mid-round.

When uncertain and no valid pre-authorized path exists: refuse, record the reason, continue where safe.

## After Arena

Preserve:

- Round 1 ranking and disagreements;
- Round 2 purchase ledger;
- signed spend records;
- Yuzu sale receipts;
- SharedOS audit evidence;
- failures/refusals;
- actual earned credits.

Use those facts for the final postmortem. Do not replace them with estimates.