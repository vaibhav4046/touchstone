"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AutoDecisionTrace, DecisionTrace, Receipt } from "../../lib/assay/receipt";
import type { Finding } from "../../lib/assay/types";

/**
 * A deal, after the fact.
 *
 * Every receipt this market issues is signed and self-contained, and until this
 * page existed that was true and useless: the evidence was handed to one buyer
 * in one HTTP response and then thrown away. Nothing a judge could open, and
 * nothing a rival could cite.
 *
 * So this page holds no deals. There is no database behind it and there is not
 * meant to be — the receipt carries the report, the kernel's own decisions, the
 * grant that paid, and what was refused, which is the entire reason a receipt
 * is worth signing. Paste one and the check happens here, in the reader's
 * browser, against the key at /api/pubkey. Yuzu is not asked whether the
 * receipt is good, and it is not trusted when it answers: this file runs the
 * same Ed25519 verification over the same canonical bytes that
 * `lib/assay/receipt.ts` signs, and it would fail identically if we were lying.
 *
 * ponytail: no persistence layer. A permalink is the receipt itself — in the
 * fragment (`/deal#r=<json>`, never sent to any server) or behind a URL you
 * host (`/deal?src=https://...`). Hosting receipts would need storage, and
 * storage is the thing a self-contained receipt exists to make unnecessary.
 */

interface PublicKeyDocument {
  readonly alg: string;
  readonly publicKeyId: string;
  readonly publicKey: string;
  readonly development: boolean;
  readonly verify: string;
}

interface Checked {
  readonly intact: boolean;
  readonly reason: string;
  readonly expired: boolean;
  readonly receipt: Receipt;
  readonly key: PublicKeyDocument;
}

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly note: string }
  | { readonly kind: "failed"; readonly message: string; readonly detail?: string }
  | { readonly kind: "done"; readonly checked: Checked };

/**
 * Canonical JSON: keys sorted at every depth, arrays left in order.
 *
 * Deliberately the same walk as `canonical` in `lib/assay/receipt.ts` and the
 * snippet served at /api/pubkey. If these three could disagree, the signature
 * would be checking bytes nobody signed.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

function bytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

export default function Verifier() {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const keyRef = useRef<PublicKeyDocument | undefined>(undefined);

  /** Fetched once and reused. Verification itself never talks to us again. */
  const publicKey = useCallback(async (): Promise<PublicKeyDocument> => {
    if (keyRef.current !== undefined) return keyRef.current;
    const response = await fetch("/api/pubkey", { cache: "force-cache" });
    if (!response.ok) throw new Error(`/api/pubkey answered ${response.status}`);
    const document = (await response.json()) as PublicKeyDocument;
    keyRef.current = document;
    return document;
  }, []);

  const check = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        setState({ kind: "failed", message: "Nothing to check.", detail: "Paste a receipt — the whole JSON object, including its signature block." });
        return;
      }

      setState({ kind: "working", note: "Reading the receipt" });
      let receipt: Receipt;
      try {
        receipt = JSON.parse(trimmed) as Receipt;
      } catch (error) {
        setState({
          kind: "failed",
          message: "That is not JSON.",
          detail: `${error instanceof Error ? error.message : String(error)}. A receipt is the object under "receipt" in any Yuzu response — copy it whole.`,
        });
        return;
      }

      if (receipt?.version !== "touchstone.receipt.v1") {
        setState({
          kind: "failed",
          message: "Not a Yuzu receipt.",
          detail: `Expected version "touchstone.receipt.v1", found ${JSON.stringify((receipt as { version?: unknown } | null)?.version ?? null)}.`,
        });
        return;
      }
      if (typeof receipt.signature?.value !== "string") {
        setState({ kind: "failed", message: "This receipt carries no signature.", detail: "There is nothing here to check. An unsigned receipt is a claim, not evidence." });
        return;
      }

      let key: PublicKeyDocument;
      try {
        setState({ kind: "working", note: "Fetching the public key" });
        key = await publicKey();
      } catch (error) {
        setState({ kind: "failed", message: "Could not read this deployment's public key.", detail: error instanceof Error ? error.message : String(error) });
        return;
      }

      // Dispatch on the receipt's own `alg`, then check against the key THIS
      // deployment publishes — never a key the receipt names. Relabelling a
      // receipt changes which check runs; every check still has to pass.
      if (receipt.signature.alg !== "ed25519") {
        setState({
          kind: "done",
          checked: {
            intact: false,
            reason:
              receipt.signature.alg === "HMAC-SHA256"
                ? "Signed with the old HMAC scheme, which is not publicly checkable — the key that would verify it also seals escalation tickets, so it is not ours to publish. Re-run the assay for a receipt anyone can check."
                : `Unknown signature algorithm ${JSON.stringify(receipt.signature.alg)}.`,
            expired: Date.parse(receipt.expiresAt) < Date.now(),
            receipt,
            key,
          },
        });
        return;
      }

      try {
        setState({ kind: "working", note: "Verifying Ed25519 in your browser" });
        const imported = await crypto.subtle.importKey("spki", bytes(key.publicKey), { name: "Ed25519" }, false, ["verify"]);
        const { signature, ...unsigned } = receipt;
        const intact = await crypto.subtle.verify(
          "Ed25519",
          imported,
          bytes(signature.value),
          new TextEncoder().encode(canonical(unsigned)),
        );
        setState({
          kind: "done",
          checked: {
            intact,
            reason: intact
              ? "The signature matches these exact contents."
              : "The signature does not match these contents. Either a field was changed after signing, or this receipt was signed by a different deployment.",
            expired: Date.parse(receipt.expiresAt) < Date.now(),
            receipt,
            key,
          },
        });
      } catch (error) {
        setState({
          kind: "failed",
          message: "Your browser would not run the check.",
          detail:
            `${error instanceof Error ? error.message : String(error)}. Web Crypto Ed25519 needs Chrome 137+, Firefox 129+ or Safari 17+. ` +
            "The check does not depend on this page: /api/pubkey serves a dependency-free Node script that does exactly the same thing offline.",
        });
      }
    },
    [publicKey],
  );

  /**
   * A receipt can arrive in the link.
   *
   * `#r=` is a fragment, so it never reaches any server — the permalink and its
   * evidence stay in the reader's browser. `?src=` is fetched from wherever you
   * host it, by the browser rather than by us, and is subject to that host's
   * CORS headers: a receipt served without them will not load, which is the
   * host's decision and not a failure of the check.
   */
  useEffect(() => {
    const fragment = window.location.hash.replace(/^#/, "");
    const inline = fragment.startsWith("r=") ? decodeURIComponent(fragment.slice(2)) : "";
    if (inline.length > 0) {
      setText(inline);
      void check(inline);
      return;
    }

    const src = new URLSearchParams(window.location.search).get("src");
    if (src === null || src.length === 0) return;

    let cancelled = false;
    void (async () => {
      setState({ kind: "working", note: `Loading ${src}` });
      try {
        const url = new URL(src, window.location.origin);
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${url.protocol} is not fetched`);
        const response = await fetch(url.toString(), { cache: "no-store" });
        if (!response.ok) throw new Error(`${url.host} answered ${response.status}`);
        const loaded = await response.text();
        if (cancelled) return;
        setText(loaded);
        await check(loaded);
      } catch (error) {
        if (cancelled) return;
        setState({
          kind: "failed",
          message: `Could not load a receipt from ${src}.`,
          detail: `${error instanceof Error ? error.message : String(error)}. Your browser fetches that URL, not this service, so it has to be reachable and CORS-readable from here. Paste the receipt instead.`,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [check]);

  return (
    <>
      <section className="panel deal-input" data-reveal>
        <div className="panel-head">
          <h2>Paste a receipt</h2>
          <p>
            The whole JSON object, signature block included — it is the <code>receipt</code> member of any reply from{" "}
            <code>/api/broker</code>, <code>/api/assay</code>, <code>/api/shortlist</code> or <code>/api/sellers</code>. Nothing is
            uploaded and nothing is stored. The only request this page makes is for the public key, and it makes that one once.
          </p>
        </div>
        <textarea
          className="deal-paste"
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          rows={8}
          placeholder='{"version":"touchstone.receipt.v1","receiptId":"rcp_…", …}'
          aria-label="Receipt JSON"
        />
        <div className="deal-actions">
          <button type="button" className="deal-go" onClick={() => void check(text)}>
            Check it
          </button>
          <button
            type="button"
            className="deal-alt"
            style={{ borderColor: "var(--yuzu)", color: "var(--yuzu-bright)", fontWeight: 600 }}
            onClick={async () => {
              setState({ kind: "working", note: "Generating verifiable sample receipt from kernel" });
              try {
                const res = await fetch("/api/broker", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ goal: "Launch competitor brief within budget", budget: 20 }),
                });
                const data = await res.json();
                if (data?.receipt) {
                  const receiptStr = JSON.stringify(data.receipt, null, 2);
                  setText(receiptStr);
                  await check(receiptStr);
                  return;
                }
              } catch (err) {
                setState({
                  kind: "failed",
                  message: "Could not fetch sample receipt.",
                  detail: err instanceof Error ? err.message : String(err),
                });
              }
            }}
          >
            ⚡ Load Live Sample Receipt
          </button>
          <button
            type="button"
            className="deal-alt"
            onClick={() => {
              setText("");
              setState({ kind: "idle" });
            }}
          >
            Clear
          </button>
          {state.kind === "done" ? (
            <button
              type="button"
              className="deal-alt"
              onClick={() => {
                const link = `${window.location.origin}/deal#r=${encodeURIComponent(JSON.stringify(state.checked.receipt))}`;
                void navigator.clipboard?.writeText(link).catch(() => undefined);
                window.location.hash = `r=${encodeURIComponent(JSON.stringify(state.checked.receipt))}`;
              }}
            >
              Copy a permalink
            </button>
          ) : null}
        </div>
        {state.kind === "working" ? (
          <p className="small muted deal-working">
            <span className="workdot" />
            {state.note}…
          </p>
        ) : null}
        {state.kind === "failed" ? (
          <p className="empty deal-oops">
            <b>{state.message}</b>
            {state.detail === undefined ? null : <> {state.detail}</>}
          </p>
        ) : null}
      </section>

      {state.kind === "done" ? <Deal checked={state.checked} /> : null}
    </>
  );
}

function Deal({ checked }: { checked: Checked }) {
  const { receipt, key, intact, expired, reason } = checked;
  const report = receipt.report;

  // Uses consumed, grouped by the grant that carried them. This is the kernel's
  // own audit stream travelling inside the receipt, not our account of it.
  const grants = new Map<string, DecisionTrace[]>();
  for (const decision of receipt.decisions) {
    if (decision.outcome !== "allowed") continue;
    const id = decision.grantId ?? "(no grant named)";
    grants.set(id, [...(grants.get(id) ?? []), decision]);
  }
  const refused = receipt.decisions.filter((decision) => decision.outcome !== "allowed");
  const autoRefused = (receipt.autoDecisions ?? []).filter((auto) => !auto.admitted || !auto.allowed);
  const notChecked = [...report.notChecked, ...report.reproducibility.unavailable];

  return (
    <>
      <section className={`panel deal-verdict${intact ? "" : " deal-broken"}`}>
        <p className="sub">
          <span className={`deal-dot ${intact ? "dot-yes" : "dot-no"}`} />
          {intact ? "Signature verified in your browser" : "Signature did not verify"}
        </p>
        <div className="deal-head">
          <span className="stamp" data-v={report.verdict}>
            {report.verdict}
          </span>
          <span className="deal-score score-big">{Math.round(report.score)}</span>
          <span className="small muted">
            / 100 · reproducible part <b className="score">{Math.round(report.deterministicScore)}</b>
          </span>
        </div>
        <h2 className="deal-vendor">{report.vendor}</h2>
        <p className="deal-headline">{report.headline}</p>
        <p className={intact ? "small muted" : "empty"}>{reason}</p>
        {intact && expired ? (
          <p className="empty">
            Intact, and past its stated life: this receipt expired on {new Date(receipt.expiresAt).toLocaleString()}. The
            signature is still good — what has lapsed is the issuer&apos;s claim that the finding is current. Re-run the
            assay rather than citing this one.
          </p>
        ) : null}
        {key.development ? (
          <p className="empty">
            This deployment signs with the committed development key, which is published in the repository. A signature
            checked against it proves the bytes are unmodified and proves nothing about who produced them.
          </p>
        ) : null}
        <div className="deck-meta deal-meta">
          <span className="chip">
            receipt <b>{receipt.receiptId}</b>
          </span>
          <span className="chip">
            buyer <b>{receipt.buyerId}</b>
          </span>
          <span className="chip">
            purpose <b>{receipt.purpose}</b>
          </span>
          <span className="chip">
            issued <b>{new Date(receipt.issuedAt).toLocaleString()}</b>
          </span>
          <span className="chip">
            key <b>{receipt.signature.publicKeyId}</b>
            {receipt.signature.publicKeyId === key.publicKeyId ? "" : ` ≠ ${key.publicKeyId}`}
          </span>
          <a className="chip chip-link" href="/api/pubkey">
            check it offline instead
          </a>
        </div>
      </section>

      {report.risks.length > 0 ? (
        <section className="panel">
          <div className="panel-head">
            <h2>What was found</h2>
            <p>Every finding names the rule that produced it and quotes the sentence that triggered it. Nothing is paraphrased.</p>
          </div>
          {report.risks.map((risk: Finding, index: number) => (
            <div className="finding" data-s={risk.severity} key={`${risk.code}-${index}`}>
              <span className="tag">
                {risk.severity} · {risk.code}
              </span>
              <p>{risk.statement}</p>
              {risk.evidence === undefined ? null : <blockquote className="deal-quote">{risk.evidence}</blockquote>}
            </div>
          ))}
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <h2>The grant that paid for it</h2>
          <p>
            Paying is minting: the credits become uses on a grant derived for this job alone, and the kernel counts them.
            Each row below is one authorised call the kernel allowed, and the count beside a grant is what it actually
            consumed — not our tally of it, the authorizer&apos;s.
          </p>
        </div>
        {grants.size === 0 ? (
          <p className="empty">
            Nothing was authorised on this receipt. That is a complete answer rather than a gap: a run refused at the
            first call spends nothing, and a receipt that recorded uses it did not make would be the failure this page
            exists to detect.
          </p>
        ) : (
          <div className="grantcards">
            {[...grants.entries()].map(([grantId, uses]) => (
              <article className="grantcard" key={grantId}>
                <header>
                  <span className="gid">{grantId}</span>
                  <span className="chip">
                    <b>{uses.length}</b> {uses.length === 1 ? "use" : "uses"} consumed
                  </span>
                </header>
                <ul className="caps">
                  {uses.map((use, index) => (
                    <li key={`${use.action}-${index}`}>
                      <span className="tag">{use.action}</span>
                      <code className="small">{use.resource}</code>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>What was refused</h2>
          <p>
            A denial is a finding, not an error. It is the record of authority this run asked for and did not get, kept
            in the receipt precisely so nobody has to take our word for where the line sat.
          </p>
        </div>
        {refused.length === 0 && autoRefused.length === 0 && receipt.escalations.length === 0 ? (
          <p className="empty">Nothing was refused on this run. Every call the kernel was asked to authorise, it allowed.</p>
        ) : (
          <ul className="stream deal-refusals">
            {refused.map((decision, index) => (
              <li data-outcome={decision.outcome} key={`d-${index}`}>
                <span className="verb">{decision.action}</span>
                <span className="res">{decision.resource}</span>
                <span className="outcome">
                  {decision.outcome} · {decision.reasonCode}
                  {decision.ceilingRule === undefined ? "" : ` · ceiling ${decision.ceilingRule}`}
                </span>
              </li>
            ))}
            {autoRefused.map((auto: AutoDecisionTrace, index: number) => (
              <li data-outcome="denied" key={`a-${index}`}>
                <span className="verb">{auto.action}</span>
                <span className="res">{auto.resource}</span>
                <span className="outcome">
                  {auto.admitted ? "owner refused" : `no precedent · ${auto.reason ?? "unknown"}`} · {auto.matcher}
                </span>
              </li>
            ))}
            {receipt.escalations.map((escalation) => (
              <li data-outcome="escalated" key={escalation.id}>
                <span className="verb">{escalation.action}</span>
                <span className="res">{escalation.resource}</span>
                <span className="outcome">
                  {escalation.state} · {escalation.id}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>What was not checked</h2>
          <p>
            The part of an assay that is worth more than the score. A verdict that does not say what it left alone is
            asking to be over-read, so every gap this run left is named here rather than averaged into a lower number.
          </p>
        </div>
        {notChecked.length === 0 ? (
          <p className="empty">
            This receipt names no gaps, which is itself unusual — read it as a claim to check rather than a clean sheet.
          </p>
        ) : (
          <ul className="rules rules-wide deal-gaps">
            {notChecked.map((gap, index) => (
              <li key={`${index}-${gap.slice(0, 24)}`}>
                <span>{gap}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted deal-repro">
          Reproducible on every run: {report.reproducibility.exact.join(", ") || "nothing"}. Model-derived, and therefore
          not a function: {report.reproducibility.modelDerived.join(", ") || "nothing"}.
        </p>
      </section>
    </>
  );
}
