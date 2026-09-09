"use client";

import { useCallback, useState } from "react";

interface Bid {
  sellerId: string;
  sellerName: string;
  price: number;
  listingScore: number;
  listingVerdict: string;
  reputation: number;
  note: string;
}
interface Proof {
  sellerId: string;
  passed: boolean;
  score: number;
  latencyMs: number;
  reason: string;
  sample: string;
}
interface Round {
  round: number;
  by: string;
  price: number;
  rationale: string;
}
interface Stage {
  stage: string;
  summary: string;
}
interface Decision {
  action: string;
  resource: string;
  outcome: string;
  reasonCode: string;
  grantId?: string;
}
interface Result {
  filled?: boolean;
  unfilled?: string;
  rfp?: { capability: string; deliverable: string };
  bids?: Bid[];
  proofs?: Proof[];
  negotiation?: Round[];
  contract?: { sellerName: string; price: number; grantId: string; grantedActions: string[] };
  delivery?: { output: string; elapsedMs: number };
  verification?: { accepted: boolean; score: number; findings: string[]; notChecked: string[] };
  settlement?: { paid: number; agreed: number; reputationBefore: number; reputationAfter: number; reason: string };
  timeline?: Stage[];
  receipt?: { receiptId: string; decisions?: Decision[]; signature: { value: string } };
  meta?: { elapsedMs: number };
  error?: string;
  message?: string;
}

const EXAMPLES = [
  "Turn my coffee brand one-pager into a six-shot list for a launch film.",
  "Launch my speciality coffee brand next week. I need a competitor brief I can act on.",
  "Write me five taglines for a note-taking app that syncs offline.",
];

export default function Market() {
  const [goal, setGoal] = useState(EXAMPLES[0]!);
  const [budget, setBudget] = useState("22");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<Stage[]>([]);
  const [result, setResult] = useState<Result | undefined>();

  /**
   * Watch the deal rather than wait for it.
   *
   * A deal takes twenty to sixty seconds, and this used to be one POST with a
   * spinner over it: the argument the whole market makes — eight stages, each
   * one you can point at afterwards — was invisible for the entire time it was
   * being made. The streaming route sends each stage as it lands. The reply is
   * read by hand rather than with EventSource because EventSource cannot POST,
   * and the goal has to go up with the request.
   */
  const plant = useCallback(async () => {
    setBusy(true);
    setResult(undefined);
    setLive([]);
    try {
      const response = await fetch("/api/broker/stream", {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-id": "yuzu-console" },
        body: JSON.stringify({ goal, budget: Number(budget) || 22 }),
      });

      if (response.body === null || !response.ok) {
        // The route refused before it began — a 400 or a 429, which is JSON.
        setResult((await response.json().catch(() => ({ error: "unreadable" }))) as Result);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line. Anything after the last one
        // is a partial frame and waits for the next chunk.
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const name = /^event:\s*(.+)$/m.exec(frame)?.[1]?.trim();
          const payload = /^data:\s*(.+)$/m.exec(frame)?.[1];
          if (name === undefined || payload === undefined) continue;
          try {
            const parsed = JSON.parse(payload) as unknown;
            if (name === "stage") setLive((current) => [...current, parsed as Stage]);
            else if (name === "done") setResult(parsed as Result);
            else if (name === "failed") setResult(parsed as Result);
          } catch {
            // A frame we cannot read is not worth abandoning the deal for.
          }
        }
      }
    } catch (error) {
      setResult({ error: "network", message: error instanceof Error ? error.message : "Request failed." });
    } finally {
      setBusy(false);
    }
  }, [goal, budget]);

  return (
    <div className="panel">
      <p className="kicker">Plant a goal</p>

      <label className="field">
        <span>What do you need done</span>
        <textarea value={goal} onChange={(event) => setGoal(event.target.value)} style={{ minHeight: "5.2rem" }} />
      </label>

      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ marginBottom: 0, maxWidth: "9rem" }}>
          <span>Budget in credits</span>
          <input type="number" value={budget} min="1" onChange={(event) => setBudget(event.target.value)} />
        </label>
        <button className="btn btn-ink" onClick={plant} disabled={busy || goal.trim().length === 0} style={{ flex: "0 0 auto" }}>
          {busy ? "The market is working…" : "Send it to the market"}
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.9rem" }}>
        {EXAMPLES.map((example) => (
          <button
            key={example}
            className="pill"
            style={{ border: "1px dashed var(--hairline)", background: "transparent", cursor: "pointer" }}
            onClick={() => setGoal(example)}
          >
            {example.slice(0, 38)}…
          </button>
        ))}
      </div>

      {result === undefined ? (
        busy ? (
          <div className="livestage">
            {live.length === 0 ? (
              <p className="muted">Reading the goal…</p>
            ) : (
              <ol>
                {live.map((event, index) => (
                  <li key={`${event.stage}-${index}`}>
                    <code>{event.stage}</code>
                    <span>{event.summary}</span>
                  </li>
                ))}
              </ol>
            )}
            <p className="muted small" style={{ marginTop: "0.6rem" }}>
              <span className="workdot" /> Each line above is a stage that has already happened, sent as it
              landed. Nothing here is a progress bar.
            </p>
          </div>
        ) : null
      ) : (
        <Outcome result={result} />
      )}
    </div>
  );
}

function Outcome({ result }: { result: Result }) {
  if (result.error !== undefined) {
    return (
      <p className="muted" style={{ marginTop: "1.4rem", color: "var(--coral)" }}>
        {result.error}: {result.message}
      </p>
    );
  }

  return (
    <div style={{ marginTop: "1.6rem", borderTop: "1px solid var(--hairline)", paddingTop: "1.2rem" }}>
      {result.timeline !== undefined && (
        <ol className="ledger" style={{ listStyle: "none", padding: 0, margin: "0 0 1.4rem" }}>
          {result.timeline.map((stage, index) => (
            <li className="ledger-row" data-o="allowed" key={index}>
              <span className="o" style={{ color: "var(--violet-deep)" }}>
                {stage.stage}
              </span>
              <span className="r">{stage.summary}</span>
            </li>
          ))}
        </ol>
      )}

      {result.bids !== undefined && result.bids.length > 0 && (
        <>
          <p className="kicker">Who bid</p>
          <div className="grid grid-2" style={{ marginBottom: "1.4rem" }}>
            {result.bids.map((bid) => (
              <div className="card" key={bid.sellerId} style={{ padding: "0.9rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
                  <strong>{bid.sellerName}</strong>
                  <span className="stamp" data-v={bid.listingVerdict} style={{ fontSize: "0.58rem", padding: "0.2rem 0.45rem" }}>
                    {bid.listingVerdict}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", margin: "0.4rem 0 0.2rem", flexWrap: "wrap" }}>
                  <div className="rep-meter" title={`Listing score: ${bid.listingScore.toFixed(1)} / 100`}>
                    <span className="muted small" style={{ fontSize: "0.72rem" }}>score {bid.listingScore.toFixed(0)}</span>
                    <span className="rep-track" style={{ width: "38px" }}>
                      <span
                        className="rep-fill"
                        data-level={bid.listingScore >= 70 ? "high" : bid.listingScore >= 40 ? "mid" : "low"}
                        style={{ width: `${Math.max(6, Math.min(100, bid.listingScore))}%` }}
                      />
                    </span>
                  </div>
                  <div className="rep-meter" title={`Reputation: ${bid.reputation.toFixed(2)}`}>
                    <span className="muted small" style={{ fontSize: "0.72rem" }}>rep {bid.reputation.toFixed(2)}</span>
                    <span className="rep-track" style={{ width: "38px" }}>
                      <span
                        className="rep-fill"
                        data-level={bid.reputation >= 0.7 ? "high" : bid.reputation >= 0.4 ? "mid" : "low"}
                        style={{ width: `${Math.max(6, Math.min(100, bid.reputation * 100))}%` }}
                      />
                    </span>
                  </div>
                </div>
                <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.8rem" }}>
                  asks <b>{bid.price}</b> credits
                </p>
                <p style={{ margin: "0.4rem 0 0", fontSize: "0.82rem" }}>{bid.note}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {result.proofs !== undefined && result.proofs.length > 0 && (
        <>
          <p className="kicker">Made to prove it</p>
          <div style={{ marginBottom: "1.4rem" }}>
            {result.proofs.map((proof) => (
              <div className="finding" data-s={proof.passed ? "info" : "critical"} key={proof.sellerId}>
                <span className="tag">
                  {proof.sellerId} · {proof.passed ? "passed" : "failed"} · {proof.latencyMs}ms
                </span>
                <p>{proof.reason}</p>
                {proof.sample.length > 0 && <blockquote>{proof.sample.slice(0, 220)}…</blockquote>}
              </div>
            ))}
          </div>
        </>
      )}

      {result.negotiation !== undefined && result.negotiation.length > 0 && (
        <>
          <p className="kicker">Haggling</p>
          <div className="ledger" style={{ marginBottom: "1.4rem" }}>
            {result.negotiation.map((round, index) => (
              <div className="ledger-row" data-o={round.by === "buyer" ? "allowed" : "escalated"} key={index}>
                <span className="o">{round.by}</span>
                <span className="r">
                  {round.price} — {round.rationale}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {result.contract !== undefined && (
        <div className="tint t-lav" style={{ marginBottom: "1.4rem" }}>
          <h3>
            {result.contract.sellerName} at {result.contract.price} credits
          </h3>
          <p>
            Paid by deriving <code>{result.contract.grantId}</code>, which permits{" "}
            <b>{result.contract.grantedActions.join(", ")}</b> and nothing else. The credits are the uses on that grant:
            spend them and the next call is refused by the kernel, not by a balance check.
          </p>
        </div>
      )}

      {result.verification !== undefined && result.settlement !== undefined && (
        <div style={{ marginBottom: "1.4rem" }}>
          <div className="verdict-row">
            <span className="stamp" data-v={result.verification.accepted ? "TRUSTED" : "FLAGGED"}>
              {result.verification.accepted ? "ACCEPTED" : "REJECTED"}
            </span>
            <div className="score-big">
              {result.settlement.paid}
              <small> / {result.settlement.agreed} paid</small>
            </div>
            <div className="muted">
              reputation {result.settlement.reputationBefore.toFixed(2)} → {result.settlement.reputationAfter.toFixed(2)}
            </div>
          </div>
          <div style={{ marginTop: "0.6rem", maxWidth: "20rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", marginBottom: "0.25rem" }}>
              <span className="muted">verification score</span>
              <span className="score">{(result.verification.score * 100).toFixed(0)} / 100</span>
            </div>
            <div className="meter-track" style={{ height: "7px" }}>
              <div
                className="meter-fill"
                data-score={result.verification.accepted ? "high" : "low"}
                style={{ width: `${Math.max(6, Math.min(100, result.verification.score * 100))}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {result.delivery !== undefined && (
        <>
          <p className="kicker">What came back</p>
          <blockquote style={{ whiteSpace: "pre-wrap", maxHeight: "17rem", overflowY: "auto", marginBottom: "1.2rem" }}>
            {result.delivery.output}
          </blockquote>
        </>
      )}

      {result.unfilled !== undefined && (
        <div className="note" style={{ marginBottom: "1.2rem" }}>
          <span className="tag" style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", letterSpacing: "0.1em" }}>
            NOTHING WAS BOUGHT
          </span>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.86rem" }}>{result.unfilled}</p>
        </div>
      )}

      {result.verification?.notChecked !== undefined && result.verification.notChecked.length > 0 && (
        <div className="note" style={{ marginBottom: "1.2rem" }}>
          <span className="tag" style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", letterSpacing: "0.1em" }}>
            WHAT NOBODY CHECKED
          </span>
          <ul>
            {result.verification.notChecked.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {result.receipt?.decisions !== undefined && result.receipt.decisions.length > 0 && (
        <>
          <p className="kicker">What the kernel allowed</p>
          <div className="ledger">
            {result.receipt.decisions.map((decision, index) => (
              <div className="ledger-row" data-o={decision.outcome} key={index}>
                <span className="o">{decision.outcome}</span>
                <span className="r">
                  {decision.action} · {decision.resource} · {decision.grantId ?? decision.reasonCode}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="muted" style={{ marginTop: "1rem", fontFamily: "var(--mono)", fontSize: "0.68rem" }}>
        {result.meta?.elapsedMs}ms · receipt {result.receipt?.receiptId} · {result.receipt?.signature.value.slice(0, 18)}…
      </p>

      {/* The deal is over and its grant has already been withdrawn, which is
          the correct lifetime. The floor is where the record of it lives. */}
      <p style={{ marginTop: "0.5rem", fontSize: "0.82rem" }}>
        <a href="/dashboard">See the grant this minted on the floor →</a>
      </p>

      {/* The receipt, handed to the page that checks it. `#r=` is a fragment,
          so the receipt never reaches any server on the way -- the check runs
          in the reader's own browser against the key at /api/pubkey. A verdict
          only its issuer can confirm is not evidence, so this is the link that
          matters most on the whole page. */}
      {result.receipt !== undefined && (
        <p style={{ marginTop: "0.35rem", fontSize: "0.82rem" }}>
          <a href={`/deal#r=${encodeURIComponent(JSON.stringify(result.receipt))}`}>
            Check this receipt yourself →
          </a>
        </p>
      )}
    </div>
  );
}
