"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SAMPLES } from "./samples";

interface Finding {
  code: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  statement: string;
  evidence?: string;
}
interface Dimension {
  id: string;
  label: string;
  score: number;
  weight: number;
  method: string;
  summary: string;
}
interface Claim {
  text: string;
  status: "VERIFIABLE" | "UNVERIFIABLE" | "CONTRADICTED";
  reason: string;
}
interface AssayResponse {
  verdict?: "TRUSTED" | "QUALIFIED" | "UNPROVEN" | "FLAGGED";
  score?: number;
  headline?: string;
  recommendedMaxPrice?: number;
  risks?: Finding[];
  dimensions?: Dimension[];
  claims?: Claim[];
  notChecked?: string[];
  receipt?: { receiptId: string; signature: { value: string } };
  meta?: { elapsedMs: number; analysis: string; interpretation: string };
  error?: string;
  message?: string;
}
interface Decision {
  at: string;
  outcome: string;
  action?: string;
  resource?: { namespace: string; path: string[] };
  grantId?: string;
  type: string;
}
interface Escalation {
  id: string;
  state: string;
  action: string;
  resource: string;
  reason: string;
  grantId?: string;
  minted?: { actions?: string[]; maxUses?: number; expiresAt?: string; scope?: string };
}

export default function Console() {
  const [vendor, setVendor] = useState(SAMPLES[0]!.vendor);
  const [price, setPrice] = useState(String(SAMPLES[0]!.askingPrice ?? ""));
  const [pitch, setPitch] = useState(SAMPLES[0]!.pitch);
  const [probe, setProbe] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AssayResponse | undefined>();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [live, setLive] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = (localStorage.getItem("touchstone-theme") as "dark" | "light" | null) ?? "dark";
    setTheme(stored);
  }, []);

  const flipTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("touchstone-theme", next);
      } catch {
        // Private window. The choice just will not persist.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/feed");
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);
    source.addEventListener("decision", (event) => {
      const decision = JSON.parse((event as MessageEvent).data) as Decision;
      if (decision.type !== "authorization.checked") return;
      setDecisions((current) => [decision, ...current].slice(0, 40));
    });
    source.addEventListener("escalation", (event) => {
      const escalation = JSON.parse((event as MessageEvent).data) as Escalation;
      setEscalations((current) => [escalation, ...current.filter((item) => item.id !== escalation.id)].slice(0, 8));
    });
    return () => source.close();
  }, []);

  const run = useCallback(async () => {
    setBusy(true);
    setResult(undefined);
    try {
      const response = await fetch("/api/assay", {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-id": "touchstone-console" },
        body: JSON.stringify({
          vendor,
          pitch,
          askingPrice: price === "" ? undefined : Number(price),
          probeEndpoint: probe === "" ? undefined : probe,
        }),
      });
      setResult((await response.json()) as AssayResponse);
      reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setResult({ error: "network", message: error instanceof Error ? error.message : "Request failed." });
    } finally {
      setBusy(false);
    }
  }, [vendor, pitch, price, probe]);

  const decide = useCallback(async (id: string, approve: boolean) => {
    const response = await fetch("/api/escalations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, approve }),
    });
    const body = (await response.json()) as { state?: string; mintedGrant?: Escalation["minted"] };
    setEscalations((current) =>
      current.map((item) =>
        item.id === id ? { ...item, state: body.state ?? item.state, minted: body.mintedGrant ?? undefined } : item,
      ),
    );
  }, []);

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <h1 className="wordmark">
            Touch<em>stone</em>
          </h1>
          <p>
            Agents are about to start buying from agents. Every listing in that market was written by someone who
            wants your credits. Rub one against the stone.
          </p>
        </div>
        <div className="spacer" />
        <span className="status">
          <span className={live ? "pip" : "pip off"} />
          {live ? "kernel live" : "kernel offline"}
        </span>
        <button className="theme-toggle" onClick={flipTheme}>
          {theme === "dark" ? "Ledger" : "Stone"}
        </button>
      </header>

      <div className="bench">
        <section className="panel">
          <h2 className="panel-title">The bench</h2>

          <div className="row">
            <label className="field">
              <span>Vendor</span>
              <input type="text" value={vendor} onChange={(event) => setVendor(event.target.value)} />
            </label>
            <label className="field">
              <span>Quoted</span>
              <input type="number" value={price} onChange={(event) => setPrice(event.target.value)} min="0" />
            </label>
          </div>

          <label className="field">
            <span>Their listing, verbatim</span>
            <textarea value={pitch} onChange={(event) => setPitch(event.target.value)} spellCheck={false} />
          </label>

          <label className="field">
            <span>Live endpoint to probe (optional)</span>
            <input
              type="text"
              value={probe}
              placeholder="https://vendor.example/health"
              onChange={(event) => setProbe(event.target.value)}
            />
          </label>

          <button className="rub" onClick={run} disabled={busy || pitch.trim().length === 0}>
            {busy ? "Rubbing…" : "Assay"}
          </button>

          <div className="samples">
            {SAMPLES.map((sample) => (
              <button
                key={sample.key}
                onClick={() => {
                  setVendor(sample.vendor);
                  setPitch(sample.pitch);
                  setPrice(String(sample.askingPrice ?? ""));
                }}
              >
                {sample.label}
              </button>
            ))}
          </div>
        </section>

        <section className="panel" ref={reportRef}>
          <h2 className="panel-title">The streak</h2>
          {result === undefined ? (
            busy ? (
              <p className="empty">Reading the material…</p>
            ) : (
              <p className="empty">Nothing on the stone yet. Paste a listing and assay it.</p>
            )
          ) : result.error !== undefined ? (
            <div className="error">
              {result.error}: {result.message}
            </div>
          ) : (
            <Report result={result} />
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">Escalations</h2>
          {escalations.length === 0 ? (
            <p className="empty">None pending. Probing a third party opens one here.</p>
          ) : (
            escalations.map((escalation) => (
              <div key={escalation.id} className={escalation.state === "pending" ? "escalation" : "escalation settled"}>
                <h4>
                  {escalation.state} · {escalation.action}
                </h4>
                <p>{escalation.reason}</p>
                {escalation.state === "pending" ? (
                  <div className="acts">
                    <button className="yes" onClick={() => decide(escalation.id, true)}>
                      Approve once
                    </button>
                    <button className="no" onClick={() => decide(escalation.id, false)}>
                      Refuse
                    </button>
                  </div>
                ) : escalation.minted ? (
                  <div className="granted">
                    minted {escalation.minted.scope} grant
                    <br />
                    actions: {escalation.minted.actions?.join(", ")}
                    <br />
                    uses: {escalation.minted.maxUses} · expires {escalation.minted.expiresAt?.slice(11, 19)}Z
                  </div>
                ) : null}
              </div>
            ))
          )}

          <h2 className="panel-title" style={{ marginTop: "2rem" }}>
            Kernel decisions
          </h2>
          {decisions.length === 0 ? (
            <p className="empty">Waiting for the first authorization.</p>
          ) : (
            decisions.map((decision, index) => (
              <div className="decision" data-o={decision.outcome} key={`${decision.at}-${index}`}>
                <span className="out">{decision.outcome}</span>
                <span className="res">
                  {decision.action} <span>·</span> {decision.resource?.path.join("/") ?? "—"}
                  {decision.grantId ? (
                    <>
                      {" "}
                      <span>· {decision.grantId}</span>
                    </>
                  ) : null}
                </span>
              </div>
            ))
          )}
        </section>
      </div>

      <footer className="colophon">
        <span>Touchstone · built on the SharedOS kernel</span>
        <a href="/api/manifest">Service manifest</a>
        <a href="/api/assay">assay</a>
        <a href="/api/shortlist">shortlist</a>
        <a href="/api/verify">verify</a>
        <a href="/api/health">health</a>
      </footer>
    </div>
  );
}

function Report({ result }: { result: AssayResponse }) {
  const verdict = result.verdict ?? "UNPROVEN";
  return (
    <>
      <div className="verdict-head">
        <span className="stamp" data-v={verdict}>
          {verdict}
        </span>
        <div className="score">
          {result.score?.toFixed(1)}
          <small> / 100</small>
        </div>
        {result.recommendedMaxPrice !== undefined ? (
          <div className="score" style={{ fontSize: "1.6rem" }}>
            {result.recommendedMaxPrice}
            <small> max fair price</small>
          </div>
        ) : null}
      </div>

      <p className="headline">{result.headline}</p>
      <p className="meta-line">
        {result.meta?.elapsedMs}ms · {result.meta?.analysis} · receipt {result.receipt?.receiptId} ·{" "}
        {result.receipt?.signature.value.slice(0, 16)}…
      </p>

      <div className="streak">
        {result.dimensions?.map((dimension) => (
          <div className="streak-row" key={dimension.id}>
            <div className="streak-label">
              {dimension.label}
              <b>
                {dimension.method} · weight {dimension.weight}
              </b>
            </div>
            <div className="streak-track" title={dimension.summary}>
              <div
                className="streak-mark"
                data-weak={dimension.score < 0.35 ? "true" : "false"}
                style={{ width: `${Math.max(2, dimension.score * 100)}%` }}
              />
            </div>
            <div className="streak-value">{(dimension.score * 100).toFixed(0)}</div>
          </div>
        ))}
      </div>

      {result.risks !== undefined && result.risks.length > 0 ? (
        <>
          <h3 className="panel-title">What a buyer should know</h3>
          {result.risks.map((risk, index) => (
            <div className="finding" data-s={risk.severity} key={`${risk.code}-${index}`}>
              <span className="tag">
                {risk.severity} · {risk.code}
              </span>
              <p>{risk.statement}</p>
              {risk.evidence ? <blockquote>{risk.evidence}</blockquote> : null}
            </div>
          ))}
        </>
      ) : null}

      {result.claims !== undefined && result.claims.length > 0 ? (
        <>
          <h3 className="panel-title" style={{ marginTop: "2rem" }}>
            Their claims
          </h3>
          {result.claims.map((claim, index) => (
            <div className="claim" key={index}>
              <span className="st" data-c={claim.status}>
                {claim.status}
              </span>
              <p>
                {claim.text}
                <small>{claim.reason}</small>
              </p>
            </div>
          ))}
        </>
      ) : null}

      {result.notChecked !== undefined && result.notChecked.length > 0 ? (
        <div className="not-checked">
          <span className="tag" style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", letterSpacing: "0.11em" }}>
            WHAT THIS ASSAY DID NOT ESTABLISH
          </span>
          <ul>
            {result.notChecked.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
