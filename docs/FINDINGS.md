# Finding register — Yuzu, SharedOS Arena

Project confirmed from this session: **Yuzu**, `D:\project\touchstone`, repo
`vaibhav4046/yuzu`, deployed at `https://yuzu-market.vercel.app`.

Rubric below is **internal**. The organisers published requirements and hard
rules in Discord, not a weighted rubric, so nothing here is an organiser verdict.

States: OPEN · FIXED_UNVERIFIED · VERIFIED · BLOCKED · ACCEPTED_LIMITATION

---

## F-01 · CRITICAL · the advertised paid endpoint refused every call

| | |
|---|---|
| Journey | A rival agent reads `agent-card.json` and calls the service it sells |
| Reproduction | `POST /api/assay` with any listing returned `UNPROVEN`, score 0, headline "material read denied by kernel policy (tool_unavailable)", while the identical listing via `POST /api/mcp` returned `TRUSTED 84.4` |
| Root cause | The route threaded its turn's `traceId` into the engine. `withTurn` snapshots authority when the turn opens; the engine deposits the order grant that makes `assay.read_claims` reachable *inside* that turn. Sharing the trace made the kernel answer from authority predating the grant, so the tool was not in the catalogue |
| Isolation | Four configurations run against real suppliers: no-turn/no-trace `TRUSTED 84.4`; plain `TRUSTED 87`; turn + route trace `UNPROVEN 0`; turn + engine's own trace `TRUSTED 87`. The turn was never the cause |
| Surfaces checked | `/api/assay`, `/api/mcp`, `/api/shortlist`, `/api/broker`. The broker survives the same pattern only because its tool calls run under a different purpose than its turn |
| Fix | `7747abc` lineage — route stops threading its trace; turn retained |
| Regression evidence | `test/assay-route-parity.test.ts`, 3 tests. Third test pins the limitation itself: a grant deposited inside a turn is still invisible to calls sharing that turn's trace |
| Independent retest | Live on the deployed revision: `TRUSTED 87`, then `TRUSTED 90.4` across 8 subsequent calls |
| Status | **VERIFIED** |

## F-02 · MAJOR · two runners answered the same request twice, in public

| | |
|---|---|
| Journey | Any buyer sending a service request while both seats are live |
| Reproduction | `yuzu-transport-check-001` answered twice, messages #115 and #116, 53 ms apart, scores 12.8 and 11.3 |
| Root cause | `alreadyAnswered()` reads the room, then calls our API, then posts. Both runners passed the read before either had posted. Reading cannot settle a write race |
| Fix | Idempotency-Key derived from the request id (`idempotencyKeyFor`), so both runners present the same key and the server settles it — identical body replays, differing body is refused 409 |
| Regression evidence | Key determinism and v4 shape asserted; duplicate path logs the 409 explicitly |
| Independent retest | `yuzu-transport-check-003` with both runners on the fixed commit produced **exactly one** reply (#121) |
| Status | **VERIFIED** |

## F-03 · MAJOR · the failover had no wall clock

| | |
|---|---|
| Journey | Any paid call during sustained supplier exhaustion, i.e. the Arena |
| Reproduction | Not reproduced live. Derived from the code path: 4 Groq models + 3 suppliers, 30 s each = 210 s worst case against a 120 s route ceiling. Past the ceiling the call dies with a platform timeout and returns **no receipt at all** |
| Root cause | Per-supplier timeouts bound one call, never the sequence |
| Fix | One wall clock across every attempt, checked *before* each one; on exhaustion the bench stops and the caller degrades to the deterministic score and still returns a signed receipt |
| Regression evidence | `test/failover-budget.test.ts`, 6 tests against `attemptWindow`. **The first version of this test was vacuous** — it exercised `complete()` end to end, healthy suppliers made the first attempt succeed, and disabling the budget outright still passed. Replaced. Mutation: removing the refusal fails 3 tests, removing the clamp to remaining time fails a 4th |
| Independent retest | `scripts/exhaustion-check.mts` strips every supplier credential from the process and runs the real engine. Measured: **0.1 s** against a 120 s ceiling, `TRUSTED 84.4`, `deterministicScore` identical, signed receipt `rcp_a22d85ca-101`, `analysis: "deterministic"`, and `notChecked` stating "Claim-by-claim model analysis: unavailable on this run" |
| Status | **VERIFIED** — degraded and honest about it, not broken |

## F-04 · MAJOR · reported market demand counted our own traffic

| | |
|---|---|
| Journey | Any decision made from the intel harness, including what to price and pitch |
| Reproduction | `arena-intel.mts` reported "assay requested 8x" as demand. Eight of those were Yuzu's own transport checks from a seat we minted |
| Root cause | The harness counted every service request in the log without separating senders. The `US` set omitted the buyer seat `i_yG9BNsV3bR` |
| Corrected measurement | 12 service requests total; 3 ours, 9 independent. **All independent requests are `verify_delivery`, from 2 distinct agents. Independent demand for anything Yuzu sells is zero** — the Arena has not opened |
| Fix | `7747abc` — senders separated, both numbers printed, buyer seat added to `US` |
| Status | **VERIFIED** (measurement corrected and re-run) |

## F-05 · MAJOR · the scheduled cloud runner has never run

| | |
|---|---|
| Journey | Presence during the Arena when the workstation is asleep. Hard rule: an agent absent from either round is not judged |
| Reproduction | `*/5` cron on the default branch, workflow `active`, **zero scheduled runs in 45 minutes**. Every cloud run to date is `workflow_dispatch` |
| Root cause | GitHub's scheduler is best-effort and drops short intervals under load. Not fixable from here |
| Mitigation | Each run now holds the seat 58 minutes instead of 5, so one firing per hour is continuous cover; three coarse schedules declared including explicit entries through the Arena window, so a miss needs several independent failures |
| Resolution | The dependency was removed rather than the scheduler fixed. Each run now dispatches its own successor **before** it starts holding the seat, using a token that can dispatch workflows (`GITHUB_TOKEN` cannot, by design). The concurrency group serialises them, so it is a chain of sub-hour runs rather than a fork bomb. Queuing first matters: a run that dies mid-seat would never reach a step at the end |
| Independent retest | Run `34729597221` at 01:04Z: step `Queue the next run before sitting down` passed, successor `34729738919` appeared pending at 01:07Z, and the local seat stayed live throughout the handover (`last_seen` 0s) |
| Status | **VERIFIED** — the chain is self-sustaining. GitHub cron itself has still never fired and is now only a third fallback behind the chain and the local supervisor |

## F-06 · MINOR · cache correctness inferred from identical scores

Identical score 90.4 across repeated calls was reported as evidence the verdict
cache works. Identical scores are consistent with a cache and also with a
deterministic path; they do not distinguish the two. **Status: ACCEPTED_LIMITATION**
— claim withdrawn, not re-substantiated. Latency is bimodal (1.4–2.7 s vs ~10 s,
n=8) which is *suggestive* of caching and is reported as latency, not as cache
correctness.

---

## Coverage, with denominators

- Test suite: **389 passed / 389 present**, 39 files
- Advertised endpoints reachable: **13 / 13** (`agent-card.json`, `manifest`, `mcp`, `broker`, `assay`, `shortlist`, `arena`, `sellers`, `verify`, `pubkey`, `grants`, `dashboard`, `deal`)
- Room service-request handling exercised live: **3 / 3** transport checks answered
- Independent buyers served: **0 / 0** — no independent demand has existed yet
- Mutation checks: F-02 key determinism, F-03 two mutants killed, F-01 three tests
- **Not exercised**: integrated supplier-exhaustion path (F-03), cron firing (F-05), any real purchase

## F-07 · MAJOR · our own dead URLs are still in the room

| | |
|---|---|
| Journey | An agent follows a link Yuzu published and calls a build with the F-01 outage in it |
| Reproduction | Messages #110, #111, #24-#27 advertise `touchstone-*.vercel.app` deployment URLs. A deployment URL is frozen to the build that made it; that build's `/api/assay` returns `UNPROVEN` 0. The messages cannot be edited or deleted |
| Fix | The agent watches for any message quoting one of those hosts and corrects it at once, once per host, before the call is spent. Retraction also posted publicly at #122 |
| Regression evidence | Host pattern checked against 4 cases: two stale deployment hosts match, `yuzu-market` and `touchstone-alpha` do not |
| Status | **VERIFIED** (mitigated; the original messages are immutable) |

## F-08 · MAJOR · the free-sample generator had never run on real input

| | |
|---|---|
| Reproduction | 0 free samples posted; the feature had only ever run in self-test |
| Verification | The detector was run over all 121 real room messages: it selects **11 distinct genuine pitches** (GovStake, Witness, Ground, Veritas, StarHall, CodeLens, TrustSieve, Grounded Research, A2A) and correctly ignores 32 non-pitch messages and 16 machine envelopes |
| Status | **VERIFIED on real data** for detection. The post itself uses the same `post()` proven by every other path, but the end-to-end live trigger has still not fired, because no agent has pitched since the feature shipped |

## Remaining risks

1. **No independent demand has been served.** Every request Yuzu has answered in
   the room was sent by Yuzu. Nothing here demonstrates a buyer choosing to pay.
   This cannot be closed by engineering: it requires another team's agent to act.
   The honest levers are in place -- the free sample, and the reciprocal transport
   check posted at #122 to TrustSieve, who invited exactly that at #93.
2. Cloud presence now rides a self-dispatching chain rather than GitHub cron, which has still never fired. The chain depends on a stored dispatch token remaining valid.
3. **Supplier exhaustion untested end to end** (F-03).
4. The older seat `i_Ey25rD9iym` still has two messages in the room pointing at a
   frozen deployment URL that serves the pre-F-01 build. Message #113 supersedes
   them; the old ones cannot be deleted.
