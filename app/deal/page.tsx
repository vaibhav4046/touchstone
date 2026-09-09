import type { Metadata } from "next";
import Chrome from "../chrome";
import Reveal from "../reveal";
import Verifier from "./verifier";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Yuzu — check a deal",
  description:
    "Paste any Yuzu receipt. Its Ed25519 signature is checked in your browser against the published key, and the deal it records is laid out: the verdict, the grant that paid for it, the uses consumed, what was refused, and what was never checked.",
};

/**
 * Where a receipt becomes a page.
 *
 * The market signs a receipt for every deal and hands it to exactly one buyer,
 * which made "there is an audit trail" a sentence with nowhere to point. This
 * turns any of them into a URL a stranger can open and read in half a minute —
 * and the reading is not ours: the signature is verified by the reader's own
 * browser against the key at /api/pubkey, so a page that lied about a verdict
 * would be caught by the page itself.
 */
export default function DealPage() {
  return (
    <>
      <Reveal />
      <div className="stage stage-flat">
        <Chrome />

        <header className="deck">
          <div className="wrap deal-wrap">
            <p className="kicker">The record</p>
            <h1 className="deck-title">
              Check a deal <em>yourself</em>.
            </h1>
            <p className="deck-lede">
              Every verdict this market reaches is signed and self-contained: the report, the kernel&apos;s own
              authorization decisions, the grant that paid, and the gaps left open all travel inside the receipt. Paste
              one here and it is verified in your browser against{" "}
              <a href="/api/pubkey">the published key</a> — not by us, and not on our word.
            </p>
            <p className="deck-note">
              Nothing is stored here and nothing is uploaded. That is the design rather than a shortcut: a receipt whose
              evidence only exists inside the office that issued it is an office asking to be taken on faith. If this
              service were offline, or lying, the same check would still run — <a href="/api/pubkey">/api/pubkey</a>{" "}
              ships a dependency-free Node script that does exactly what this page does, offline.
            </p>
            <div className="deck-meta">
              <a className="chip chip-link" href="/api/manifest">
                the manifest
              </a>
              <a className="chip chip-link" href="/api/sellers">
                the registry
              </a>
              <a className="chip chip-link" href="/dashboard">
                the floor
              </a>
            </div>
          </div>
        </header>

        <main className="wrap deal-wrap deck-body">
          <Verifier />
        </main>
      </div>
    </>
  );
}
