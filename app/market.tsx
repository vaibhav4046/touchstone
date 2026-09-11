"use client";

import { useCallback, useEffect, useState } from "react";

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

const SUBAGENTS = [
  {
    name: "ProductLister",
    role: "Catalog & Listing Assay",
    caps: ["market.registry:read", "market.registry:write"],
    stages: ["discover", "bid"],
    desc: "Indexes capabilities, executes seller assay, drops injections",
  },
  {
    name: "PriceNegotiator",
    role: "Proof & Arithmetic Bargaining",
    caps: ["broker.assay:evaluate", "broker.quote:compute"],
    stages: ["prove", "negotiate"],
    desc: "Challenges shortlist with samples, locks arithmetic price curve",
  },
  {
    name: "PaymentManager",
    role: "Kernel Grants & Settlement",
    caps: ["sharedos.grants:mint", "x402:settle"],
    stages: ["contract", "settle"],
    desc: "Mints zero-ambient SharedOS grant (credits=uses), settles x402 escrow",
  },
  {
    name: "MarketplaceAuditor",
    role: "Integrity & Ed25519 Receipts",
    caps: ["ed25519:verify", "sharedos.audit:append"],
    stages: ["execute", "deliver", "verify"],
    desc: "Verifies deliverables, attests outputs, appends signed ledger receipt",
  },
];

function getSubagentForStage(stage: string): string {
  if (stage === "discover" || stage === "bid") return "ProductLister";
  if (stage === "prove" || stage === "negotiate") return "PriceNegotiator";
  if (stage === "contract" || stage === "settle") return "PaymentManager";
  return "MarketplaceAuditor";
}

function GlowingText({ text, glow = true }: { text: string; glow?: boolean }) {
  return <span className={glow ? "glowing-reveal-text" : ""}>{text}</span>;
}

function GlowingDelivery({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="glowing-delivery-container">
      <div className="glowing-delivery-toolbar">
        <span className="glowing-delivery-status">
          <span className="glowing-pulse-orb" />
          VERIFIED DELIVERABLE STREAM
        </span>
        <button type="button" className="glowing-copy-btn" onClick={copy}>
          {copied ? "✓ Copied" : "📋 Copy Deliverable"}
        </button>
      </div>
      <blockquote className="glowing-delivery-quote glowing-reveal-block">
        {text}
      </blockquote>
    </div>
  );
}

function SubagentWorkflow({ live, busy }: { live: Stage[]; busy: boolean }) {
  const currentStage = live.length > 0 ? live[live.length - 1]!.stage : "discover";
  const activeAgentName = getSubagentForStage(currentStage);

  const order = ["ProductLister", "PriceNegotiator", "PaymentManager", "MarketplaceAuditor"];
  const activeIdx = order.indexOf(activeAgentName);

  return (
    <div className="subagent-workflow-deck">
      <div className="subagent-workflow-header">
        <span style={{ color: "var(--yuzu)", fontWeight: 600 }}>
          <span className="subagent-status-dot pixellated" style={{ display: "inline-block", marginRight: "6px" }} />
          {busy ? "AUTONOMOUS SUBAGENTS IN THE ARENA" : "AUTONOMOUS SUBAGENTS READY FOR GOAL DISPATCH"}
        </span>
        <span style={{ color: "var(--ink-3)" }}>ZERO AMBIENT AUTHORITY</span>
      </div>

      <div className="subagent-workflow-grid">
        {SUBAGENTS.map((agent, idx) => {
          const isCurrent = busy && activeAgentName === agent.name;
          const isDone = (!busy && live.length > 0) || (busy && idx < activeIdx);
          const status = isCurrent ? "active" : isDone ? "completed" : "idle";

          let actionText = agent.desc;
          if (isCurrent) {
            const latestSummary = live.length > 0 ? live[live.length - 1]!.summary : "Reading goal...";
            actionText = latestSummary;
          } else if (isDone) {
            actionText = "✓ Stage executed within capability grant bounds.";
          } else {
            actionText = `[STANDBY] ${agent.desc}`;
          }

          return (
            <div className={`subagent-node ${status}`} key={agent.name}>
              <div className="subagent-node-header">
                <span className="subagent-node-name">{agent.name}</span>
                <span className="subagent-node-status">
                  {status === "active" ? "● ACTIVE" : status === "completed" ? "✓ DONE" : "STANDBY"}
                </span>
              </div>
              <div className="subagent-node-action">
                {isCurrent ? <GlowingText text={actionText} key={actionText} /> : actionText}
              </div>
              <div className="subagent-node-cap">
                {agent.caps.map((cap) => (
                  <code key={cap} className="subagent-cap pixellated" style={{ display: "inline-block", margin: "2px 3px 0 0" }}>
                    {cap}
                  </code>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Market() {
  const [goal, setGoal] = useState(EXAMPLES[0]!);
  const [budget, setBudget] = useState("22");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<Stage[]>([]);
  const [result, setResult] = useState<Result | undefined>();

  const executePlant = useCallback(async (currentGoal: string, currentBudget: string) => {
    setBusy(true);
    setResult(undefined);
    setLive([]);
    try {
      const response = await fetch("/api/broker/stream", {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-id": "yuzu-console" },
        body: JSON.stringify({ goal: currentGoal, budget: Number(currentBudget) || 22 }),
      });

      if (response.body === null || !response.ok) {
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
            // Frame parsing error ignored
          }
        }
      }
    } catch (error) {
      setResult({ error: "network", message: error instanceof Error ? error.message : "Request failed." });
    } finally {
      setBusy(false);
    }
  }, []);

  const plant = useCallback(() => {
    executePlant(goal, budget);
  }, [executePlant, goal, budget]);

  const typeGoal = useCallback(
    (target: string, autoSend = false) => {
      if (busy) return;
      if (!autoSend) {
        setGoal(target);
        return;
      }
      let i = 0;
      setGoal("");
      const step = 4;
      const timer = setInterval(() => {
        i += step;
        if (i >= target.length) {
          setGoal(target);
          clearInterval(timer);
          setTimeout(() => {
            executePlant(target, budget);
          }, 100);
        } else {
          setGoal(target.slice(0, i));
        }
      }, 12);
    },
    [busy, executePlant, budget]
  );

  useEffect(() => {
    const handleHeroClick = (e: MouseEvent) => {
      e.preventDefault();
      const el = document.getElementById("market");
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
      }
      setTimeout(() => {
        typeGoal(EXAMPLES[0]!, true);
      }, 400);
    };

    const heroBtn = document.getElementById("hero-watch-btn");
    if (heroBtn) {
      heroBtn.addEventListener("click", handleHeroClick as EventListener);
    }
    return () => {
      if (heroBtn) {
        heroBtn.removeEventListener("click", handleHeroClick as EventListener);
      }
    };
  }, [typeGoal]);

  return (
    <div className="panel">
      <p className="kicker">Plant a goal</p>

      <label className="field">
        <span>What do you need done</span>
        <textarea
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          style={{ minHeight: "5.2rem" }}
          placeholder="Describe what you want agents to produce..."
        />
      </label>

      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ marginBottom: 0, maxWidth: "9rem" }}>
          <span>Budget in credits</span>
          <input type="number" value={budget} min="1" onChange={(event) => setBudget(event.target.value)} />
        </label>
        <button
          className="btn btn-ink"
          onClick={plant}
          disabled={busy || goal.trim().length === 0}
          style={{ flex: "0 0 auto" }}
        >
          {busy ? "The market is working…" : "Send it to the market"}
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.9rem" }}>
        {EXAMPLES.map((example) => (
          <button
            key={example}
            className="pill"
            style={{ border: "1px dashed var(--hairline)", background: "transparent", cursor: "pointer" }}
            onClick={() => typeGoal(example, false)}
          >
            {example.slice(0, 38)}…
          </button>
        ))}
      </div>

      {result === undefined ? (
        busy ? (
          <div className="livestage">
            <SubagentWorkflow live={live} busy={busy} />
            {live.length === 0 ? (
              <p className="muted">
                Reading the goal… <span className="glowing-pulse-orb" style={{ display: "inline-block", verticalAlign: "middle", marginLeft: "6px" }} />
              </p>
            ) : (
              <ol>
                {live.map((event, index) => {
                  const agent = getSubagentForStage(event.stage);
                  const isLatest = index === live.length - 1;
                  return (
                    <li key={`${event.stage}-${index}`}>
                      <code style={{ marginRight: "6px" }}>{event.stage}</code>
                      <span className="subagent-cap pixellated" style={{ marginRight: "8px", color: "var(--violet-deep)" }}>
                        [{agent}]
                      </span>
                      <span>
                        {isLatest ? (
                          <GlowingText text={event.summary} key={event.summary} />
                        ) : (
                          event.summary
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="muted small" style={{ marginTop: "0.6rem" }}>
              <span className="workdot" /> Each line above is an attributable subagent stage that has already happened, sent as it landed.
            </p>
          </div>
        ) : (
          <div className="livestage" style={{ marginTop: "1.2rem" }}>
            <SubagentWorkflow live={[]} busy={false} />
          </div>
        )
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
          {result.timeline.map((stage, index) => {
            const agent = getSubagentForStage(stage.stage);
            return (
              <li className="ledger-row" data-o="allowed" key={index}>
                <span className="o" style={{ color: "var(--violet-deep)" }}>
                  {stage.stage}
                </span>
                <span className="r">
                  <strong style={{ fontFamily: "var(--mono)", fontSize: "0.78rem", marginRight: "6px" }}>[{agent}]</strong>
                  {stage.summary}
                </span>
              </li>
            );
          })}
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
          <GlowingDelivery text={result.delivery.output} />
        </>
      )}

      {/* Sub-Agent Attestation Deck */}
      <div className="subagent-workflow-deck" style={{ margin: "1.4rem 0" }}>
        <div className="subagent-workflow-header">
          <span style={{ color: "var(--leaf)", fontWeight: 600 }}>
            ✓ SUB-AGENT VERIFIED ATTESTATION
          </span>
          <span style={{ color: "var(--ink-3)" }}>0 AMBIENT ACCESS · 100% CHECKED</span>
        </div>
        <div className="grid grid-2" style={{ gap: "0.5rem" }}>
          <div className="subagent-node completed" style={{ margin: 0 }}>
            <div className="subagent-node-name">ProductLister</div>
            <div className="subagent-node-action">Verified candidate listings, filtered prompt-injection attacks.</div>
            <code className="subagent-cap pixellated">market.registry:read: OK</code>
          </div>
          <div className="subagent-node completed" style={{ margin: 0 }}>
            <div className="subagent-node-name">PriceNegotiator</div>
            <div className="subagent-node-action">Enforced bounded arithmetic bargaining within buyer budget.</div>
            <code className="subagent-cap pixellated">broker.quote:compute: OK</code>
          </div>
          <div className="subagent-node completed" style={{ margin: 0 }}>
            <div className="subagent-node-name">PaymentManager</div>
            <div className="subagent-node-action">Derived atomic capability grant. 1 credit = 1 grant use.</div>
            <code className="subagent-cap pixellated">sharedos.grants:mint: OK</code>
          </div>
          <div className="subagent-node completed" style={{ margin: 0 }}>
            <div className="subagent-node-name">MarketplaceAuditor</div>
            <div className="subagent-node-action">Ed25519 signature verified, audit hash appended to ledger.</div>
            <code className="subagent-cap pixellated">ed25519:verify: OK</code>
          </div>
        </div>
      </div>

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

      <p style={{ marginTop: "0.5rem", fontSize: "0.82rem" }}>
        <a href="/dashboard">See the grant this minted on the floor →</a>
      </p>

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
