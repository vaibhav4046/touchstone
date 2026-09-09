/**
 * The Agent Commerce Protocol, as Yuzu implements it.
 *
 * A listing is a claim, a bid is a price on a claim, and a contract is the only
 * one of the three that confers anything. The stages below are deliberately
 * separate because each is a different question, and a market that answers them
 * all at once is one where nobody can say which answer was wrong:
 *
 *   discover -> bid -> prove -> negotiate -> contract -> execute -> verify -> settle
 *
 * Every stage is a kernel-authorised call under its own purpose, so the audit
 * trail reads as the story of the deal rather than a list of function names.
 */

export type Stage =
  | "discover"
  | "bid"
  | "prove"
  | "negotiate"
  | "contract"
  | "execute"
  | "verify"
  | "settle";

export interface Capability {
  /** Dotted verb the seller answers to, e.g. `research.brief` or `copy.taglines`. */
  readonly id: string;
  readonly summary: string;
}

export interface SellerAgent {
  readonly id: string;
  readonly name: string;
  /** How the seller describes itself. Assayed like any other listing. */
  readonly pitch: string;
  readonly capabilities: readonly Capability[];
  /** Arena credits the seller opens at. Negotiation moves it, never below floor. */
  readonly askPrice: number;
  readonly floorPrice: number;
  readonly etaSeconds: number;
  /** Where the seller lives. Local sellers run inside Yuzu; remote ones are called over HTTP. */
  readonly endpoint?: string;
  readonly sharednetNode?: string;
  readonly registeredBy: string;
  readonly registeredAt: string;
}

export interface Reputation {
  readonly sellerId: string;
  /** Contracts that reached a verified delivery. */
  readonly delivered: number;
  readonly failed: number;
  /** Mean verification score across delivered work, 0..1. Absent until there is one. */
  readonly quality?: number;
  /** 0..1. Starts at neutral and is only moved by verified outcomes. */
  readonly score: number;
  readonly lastContractAt?: string;
}

export interface Rfp {
  readonly id: string;
  readonly goal: string;
  readonly capability: string;
  readonly deliverable: string;
  readonly budget: number;
  readonly deadlineSeconds: number;
  readonly constraints: readonly string[];
}

export interface Bid {
  readonly sellerId: string;
  readonly sellerName: string;
  readonly price: number;
  readonly etaSeconds: number;
  readonly reputation: number;
  /** Assay of the seller's listing — the same engine that grades any other claim. */
  readonly listingScore: number;
  readonly listingVerdict: string;
  readonly note: string;
}

export interface ProofChallenge {
  readonly sellerId: string;
  readonly prompt: string;
  readonly sample: string;
  /** 0..1 from the verifier. Only means anything when `proven` is true. */
  readonly score: number;
  readonly adherence: number;
  readonly latencyMs: number;
  /**
   * A sample was obtained and judged.
   *
   * False when the challenge could not be run at all, which is a fact about our
   * upstream rather than about the seller. Such a seller stays shortlisted
   * (failing it for our outage empties real shortlists) but it has demonstrated
   * nothing, and every line that follows has to keep saying so.
   */
  readonly proven: boolean;
  readonly passed: boolean;
  readonly reason: string;
}

export interface NegotiationRound {
  readonly round: number;
  readonly by: "buyer" | "seller";
  readonly price: number;
  readonly rationale: string;
}

export interface Contract {
  readonly id: string;
  readonly rfpId: string;
  readonly sellerId: string;
  readonly sellerName: string;
  readonly price: number;
  readonly deadlineSeconds: number;
  readonly deliverable: string;
  /** The grant minted for this contract, and nothing wider. */
  readonly grantId: string;
  /** Uses on that grant. The price and this number are the same integer. */
  readonly credits: number;
  readonly grantedActions: readonly string[];
  readonly expiresAt: string;
  readonly agreedAt: string;
}

export interface Delivery {
  readonly contractId: string;
  readonly output: string;
  readonly elapsedMs: number;
  readonly onTime: boolean;
}

export interface Verification {
  readonly contractId: string;
  /** 0..1 across the axes the verifier actually checked. */
  readonly score: number;
  readonly adherence: number;
  /**
   * The work was actually assessed. False when our own output budget cut the
   * delivery short, in which case reputation must not move on it.
   */
  readonly judged: boolean;
  readonly accepted: boolean;
  readonly findings: readonly string[];
  readonly notChecked: readonly string[];
}

export interface Settlement {
  readonly contractId: string;
  readonly agreed: number;
  /**
   * Uses the kernel has spent on this contract's grant, read from the usage
   * store. Not our count of anything — the authorizer's.
   *
   * It is here so the one place the charge and the meter can differ says so out
   * loud. Taking the delivery is itself an authorised call and costs a use, so
   * a delivery that is then rejected leaves this at one against a `paid` of
   * zero: the buyer is not charged for work it refused, and the use the attempt
   * really did consume is still on the record rather than quietly missing.
   */
  readonly consumed: number;
  /**
   * What actually moved, read off `consumed` rather than restated from
   * `agreed`. An accepted delivery is charged its whole price by spending the
   * grant down; a rejected one settles at zero.
   */
  readonly paid: number;
  readonly reason: string;
  readonly reputationBefore: number;
  readonly reputationAfter: number;
}

export interface StageEvent {
  readonly stage: Stage;
  readonly at: string;
  readonly summary: string;
  readonly detail?: Record<string, unknown>;
}
