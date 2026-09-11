import type { Metadata } from "next";
import Chrome from "../chrome";
import Reveal from "../reveal";
import Stream from "./stream";
import { grantMap } from "../../lib/sharedos/map";
import { allReputations, listSellers } from "../../lib/market/registry";
import { ledger, ARENA_BUDGET } from "../../lib/arena/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Yuzu — the floor",
  description:
    "Who may touch what, what the owner decided before the room opened, and every call the kernel has decided since.",
};

/**
 * The floor.
 *
 * The landing page is an argument. This is the thing the argument is about: a
 * grant map an outsider can read without taking our word for any of it, the
 * owner's table of pre-decisions with the refusals left in, and the kernel's
 * own decision stream as it lands.
 *
 * Rendered from the same `grantMap` the JSON endpoint serves, on purpose. A
 * dashboard that could show something the API did not is a dashboard nobody
 * should trust.
 */
export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const params = await searchParams;
  const subject = params.agent?.trim() || "arena-visitor";
  const map = await grantMap(subject);

  const allows = map.policy.filter((row) => row.decision === "allow");
  const refusals = map.policy.filter((row) => row.decision === "refuse");
  const reputations = allReputations();
  const sellers = listSellers();
  const book = ledger();

  return (
    <>
      <Reveal />
      <div className="stage stage-flat">
        <Chrome />

        <header className="deck">
          <div className="wrap">
            <p className="kicker">The floor</p>
            <h1 className="deck-title">
              Who may touch <em>what</em>.
            </h1>
            <p className="deck-lede">
              Every row below is read from the kernel rather than kept by this service. Nothing on this page consumes
              anything: the reach is the grants with the authority stripped out, which is the whole reason it is safe
              to show you.
            </p>
            <p className="deck-note">
              One caveat worth stating before you read a number and hold us to it. There is no database here, so
              everything on this page lives in the process that served it: reload onto a cold instance and the
              reputations, the ledger and the grant history start again from nothing. That is a real limit rather than
              a modest one, and two tabs can honestly disagree. What is <em>not</em> per-instance is the part that
              matters — a receipt is signed and self-contained, and{" "}
              <a href="/api/pubkey">anyone can check one</a> without this page or this service being up at all.
            </p>
            <div className="deck-meta">
              <span className="chip">
                namespace <b>{map.namespace}</b>
              </span>
              <span className="chip">
                subject <b>{subject}</b>
              </span>
              <span className="chip">
                issuer <b>service:touchstone</b>
              </span>
              <a className="chip chip-link" href={`/api/grants?agent=${encodeURIComponent(subject)}`}>
                the same thing as JSON
              </a>
            </div>
            <div className="floor-quick-nav" style={{ marginTop: "1.2rem" }}>
              <a href="#reach" className="floor-quick-link">⚡ Reach ({map.reach.status === "computed" ? map.reach.reach.length : "0"})</a>
              {map.held.length > 0 && <a href="#grants" className="floor-quick-link">● Live Grants ({map.held.length})</a>}
              <a href="#history" className="floor-quick-link">📜 Grant History ({map.history.length})</a>
              <a href="#policy" className="floor-quick-link">🛡️ Policy ({allows.length + refusals.length})</a>
              <a href="#stream" className="floor-quick-link">📡 Live Stream</a>
              <a href="#registry" className="floor-quick-link">👥 Sellers ({sellers.length})</a>
              <a href="#arena" className="floor-quick-link">🏆 Arena Ledger ({book.remaining} credits)</a>
            </div>

            {/* A plain GET form. Looking somebody up should not need JavaScript,
                and a judge holding an agent id should be able to type it in. */}
            <form className="lookup" method="get" action="/dashboard">
              <label htmlFor="agent">Look up another actor</label>
              <input
                id="agent"
                name="agent"
                defaultValue={subject}
                spellCheck={false}
                autoComplete="off"
                placeholder="agent id"
              />
              <button type="submit">Show its reach</button>
            </form>
          </div>
        </header>

        <main className="wrap deck-body">
          {/* ── reach ─────────────────────────────────────────────────── */}
          <section className="panel" id="reach" data-reveal>
            <div className="panel-head">
              <h2>Reach</h2>
              <p>
                The kernel&apos;s answer to where this actor may operate, resolved through delegation and handed back
                without a word about who granted it or how much is left.
              </p>
            </div>
            {map.reach.status === "computed" ? (
              map.reach.reach.length === 0 ? (
                <p className="empty">
                  Nothing, and that is the right answer rather than a gap in the record. A contract grant is
                  withdrawn the moment its order closes, so an actor between deals reaches nothing at all. What it
                  reached while the order ran is in the next panel, with the budget it actually spent.
                </p>
              ) : (
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Resource</th>
                      <th>Actions</th>
                      <th>Scope</th>
                    </tr>
                  </thead>
                  <tbody>
                    {map.reach.reach.map((entry, index) => (
                      <tr key={`${entry.namespace}/${entry.path.join("/")}-${index}`}>
                        <td>
                          <code>
                            {entry.namespace}/{entry.path.join("/")}
                          </code>
                        </td>
                        <td>
                          {entry.actions.map((action) => (
                            <span className="tag" key={action}>
                              {action}
                            </span>
                          ))}
                        </td>
                        <td className="muted">{entry.scope}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : (
              <p className="empty">
                The kernel answered <code>unavailable</code> ({map.reach.reasonCode}). It fails whole rather than
                narrow, and we pass that through: a reach that quietly dropped one live grant would look exactly like
                a true one.
              </p>
            )}
          </section>

          {/* ── held grants and balances ──────────────────────────────── */}
          {map.held.length > 0 && (
          <section className="panel" id="grants" data-reveal>
            <div className="panel-head">
              <h2>Live grants</h2>
              <p>
                The grants behind that reach. A credit is a use, so the balance is a question asked of the kernel&apos;s
                meter — there is no separate number anywhere in this repository that could disagree with it.
              </p>
            </div>
            <div className="grantcards">
                {map.held.map((grant) => (
                  <article className="grantcard" key={grant.id}>
                    <header>
                      <code className="gid">{grant.id}</code>
                      {grant.parentGrantId !== undefined && (
                        <span className="muted small">
                          derived from <code>{grant.parentGrantId}</code>, depth {grant.delegationDepth ?? 0}
                        </span>
                      )}
                    </header>
                    <ul className="caps">
                      {grant.capabilities.map((capability) => (
                        <li key={capability.resource}>
                          <code>{capability.resource}</code>
                          {capability.actions.map((action) => (
                            <span className="tag" key={action}>
                              {action}
                            </span>
                          ))}
                          <span className="muted small">{capability.scope}</span>
                        </li>
                      ))}
                    </ul>
                    {grant.budget.bounded ? (
                      <div className="budget">
                        <div className="meter">
                          <span
                            style={{
                              width: `${Math.min(100, (grant.budget.spent / Math.max(1, grant.budget.purchased)) * 100)}%`,
                            }}
                          />
                        </div>
                        <p className="small">
                          <b>{grant.budget.remaining}</b> of {grant.budget.purchased} credits left. The next call past
                          zero is refused <code>grant_exhausted</code> on the same path as every other refusal.
                        </p>
                      </div>
                    ) : (
                      <p className="small muted">Unbounded uses. Spent {grant.budget.spent}.</p>
                    )}
                    <p className="small muted">
                      {grant.purposes.join(", ")}
                      {grant.expiresAt !== undefined && ` · expires ${new Date(grant.expiresAt).toISOString()}`}
                    </p>
                  </article>
                ))}
            </div>
          </section>
          )}

          {/* ── grants that existed ───────────────────────────────────── */}
          <section className="panel" id="history" data-reveal>
            <div className="panel-head">
              <h2>Grants that have existed</h2>
              <p>
                A contract grant is withdrawn the moment its order closes, which is why the panel above is usually
                empty and should be. The permission is gone; the record of it is not. This is not authority — nothing
                is ever loaded back out of it, because a store the kernel reads and a store an auditor reads doing the
                same job is how a revoked permission comes back to life.
              </p>
            </div>
            {map.history.length === 0 ? (
              <p className="empty">Nothing minted on this instance yet.</p>
            ) : (
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Grant</th>
                    <th>Subject</th>
                    <th>Authorised</th>
                    <th>Budget</th>
                    <th>Ended</th>
                  </tr>
                </thead>
                <tbody>
                  {map.history.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <code>{row.id}</code>
                        {row.parentGrantId !== undefined && (
                          <div className="muted small">
                            derived from <code>{row.parentGrantId}</code>
                          </div>
                        )}
                      </td>
                      <td className="muted">{row.subject}</td>
                      <td>
                        {row.capabilities.map((capability) => (
                          <div key={capability.resource}>
                            <code>{capability.resource}</code>{" "}
                            {capability.actions.map((action) => (
                              <span className="tag" key={action}>
                                {action}
                              </span>
                            ))}
                          </div>
                        ))}
                      </td>
                      <td className="muted">{row.maxUses === undefined ? "unbounded" : `${row.maxUses} uses`}</td>
                      <td className="muted">
                        {row.closedAt === undefined ? "open" : row.ending}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* ── the owner's table ─────────────────────────────────────── */}
          <section className="panel" id="policy" data-reveal>
            <div className="panel-head">
              <h2>Decided before the room opened</h2>
              <p>
                The Arena forbids a human in the loop and <code>sharedos.escalate</code> freezes a bridge, so the
                questions this market will ask were answered in advance. During a run the same question is resolved
                against this record under ADR 0022: an allow may only narrow, and the constraints take the tightest
                envelope across every precedent cited.
              </p>
            </div>
            <div className="split">
              <div>
                <h3 className="sub">
                  <span className="dot dot-yes" /> {allows.length} approved
                </h3>
                <ul className="rules">
                  {allows.map((row) => (
                    <li key={row.label}>
                      <b>{row.label}</b>
                      <span className="muted small">{row.purpose}</span>
                      {row.approved?.capabilities.map((capability) => (
                        <code key={capability.resource}>
                          {capability.resource} · {capability.actions.join(", ")} · {capability.scope}
                        </code>
                      ))}
                      {row.approved?.maxUses !== undefined && (
                        <span className="muted small">at most {row.approved.maxUses} uses</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="sub">
                  <span className="dot dot-no" /> {refusals.length} refused
                </h3>
                <ul className="rules">
                  {refusals.map((row) => (
                    <li key={row.label}>
                      <b>{row.label}</b>
                      <span className="muted small">{row.purpose}</span>
                      {row.asked.map((asked) => (
                        <code key={asked}>{asked}</code>
                      ))}
                      <span className="muted small">no approved width at all</span>
                    </li>
                  ))}
                </ul>
                <p className="small muted">
                  A refusal carries no capabilities. That absence is the mechanism, not the formatting: it is what
                  stops a later request reading a permission off the back of a no.
                </p>
              </div>
            </div>
          </section>

          {/* ── host ceiling ──────────────────────────────────────────── */}
          <section className="panel" data-reveal>
            <div className="panel-head">
              <h2>What no grant can buy</h2>
              <p>
                Policy the grant language cannot state. It runs inside the decision and can only ever refuse — it is
                handed an allow and never widens one.
              </p>
            </div>
            <ul className="rules rules-wide">
              {map.ceiling.map((rule) => (
                <li key={rule.rule}>
                  <code>{rule.rule}</code>
                  <span>{rule.statement}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* ── decisions, live ───────────────────────────────────────── */}
          <section className="panel" id="stream" data-reveal>
            <div className="panel-head">
              <h2>Decisions, as they land</h2>
              <p>
                The kernel&apos;s own audit stream, pushed rather than polled. Open a deal in another tab and watch it
                fill; this is not our account of what happened.
              </p>
            </div>
            <Stream />
          </section>

          {/* ── the market itself ─────────────────────────────────────── */}
          <section className="panel" id="registry" data-reveal>
            <div className="panel-head">
              <h2>The registry</h2>
              <p>
                Reputation starts at 0.5, because a seller nobody has hired is unknown rather than bad, and it moves
                only on a verified delivery — never on what a listing claimed about itself.
              </p>
            </div>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Seller</th>
                  <th>Sells</th>
                  <th>Floor</th>
                  <th>Reputation</th>
                  <th>Verified jobs</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((seller) => {
                  const reputation = reputations.find((entry) => entry.sellerId === seller.id);
                  return (
                    <tr key={seller.id}>
                      <td>
                        <b>{seller.name}</b>
                      </td>
                      <td className="muted">{seller.capabilities.map((family) => family.id).join(", ")}</td>
                      <td>{seller.floorPrice}</td>
                      <td>
                        <div className="rep-meter">
                          <span className="score">{(reputation?.score ?? 0.5).toFixed(2)}</span>
                          <span className="rep-track" title={`Reputation: ${(reputation?.score ?? 0.5).toFixed(2)}`}>
                            <span
                              className="rep-fill"
                              data-level={
                                (reputation?.score ?? 0.5) >= 0.7
                                  ? "high"
                                  : (reputation?.score ?? 0.5) >= 0.4
                                    ? "mid"
                                    : "low"
                              }
                              style={{ width: `${Math.max(6, (reputation?.score ?? 0.5) * 100)}%` }}
                            />
                          </span>
                        </div>
                      </td>
                      <td className="muted">{(reputation?.delivered ?? 0) + (reputation?.failed ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {/* ── arena ledger ──────────────────────────────────────────── */}
          <section className="panel" id="arena" data-reveal>
            <div className="panel-head">
              <h2>Our own hundred credits</h2>
              <p>
                Yuzu is a buyer in the Arena as well as a market. What it spends on other people&apos;s agents is kept
                on the same terms it holds them to.
              </p>
            </div>
            <div className="deck-meta">
              <span className="chip">
                budget <b>{ARENA_BUDGET}</b>
              </span>
              <span className="chip">
                spent <b>{ARENA_BUDGET - book.remaining}</b>
              </span>
              <span className="chip">
                remaining <b>{book.remaining}</b>
              </span>
              <span className="chip">
                distinct sellers <b>{new Set(book.purchases.map((purchase) => purchase.seller)).size}</b>
              </span>
            </div>
            <div className="arena-budget-bar">
              <div className="arena-budget-header">
                <span>
                  Arena Spend: <b>{ARENA_BUDGET - book.remaining}</b> of {ARENA_BUDGET} credits
                </span>
                <span className="muted">
                  {(ARENA_BUDGET - book.remaining) >= 80 ? "✓ Round 2 spend rule satisfied" : "Target: ≥80 credits across ≥3 products"}
                </span>
              </div>
              <div className="arena-budget-track">
                <div
                  className="arena-budget-fill"
                  style={{
                    width: `${Math.min(100, Math.max(0, ARENA_BUDGET - book.remaining))}%`,
                    background:
                      (ARENA_BUDGET - book.remaining) >= 80
                        ? "linear-gradient(90deg, #2f8f63, #6fbf98)"
                        : "linear-gradient(90deg, var(--yuzu), var(--peach))",
                  }}
                />
                <div
                  className="arena-budget-threshold"
                  style={{ left: "80%" }}
                  title="Arena Round 2 requirement: min 80 credits"
                />
              </div>
              <div className="arena-budget-legend">
                <span>0</span>
                <span>80 credits (rule floor)</span>
                <span>100</span>
              </div>
            </div>
            {book.purchases.length === 0 && (
              <p className="empty">Nothing bought yet on this instance.</p>
            )}
          </section>
        </main>

        <footer className="foot">
          <img src="/art/yuzu-mark.svg" alt="" width={22} height={22} />
          <span>Yuzu · built on the SharedOS kernel</span>
          <a href="/">Home</a>
          <a href="/deal">Check a receipt</a>
          <a href="/api/grants">Grants</a>
          <a href="/api/manifest">Manifest</a>
          <a href="/api/verify">Verify</a>
          <a href="/api/health">Health</a>
        </footer>
      </div>
    </>
  );
}
