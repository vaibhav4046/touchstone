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
  /** The seller's own confidence. Treated as a claim, never as evidence. */
  readonly confidence: number;
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
  /** 0..1 from the verifier. This is evidence; `confidence` above is not. */
  readonly score: number;
  readonly adherence: number;
  readonly latencyMs: number;
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
  readonly accepted: boolean;
  readonly findings: readonly string[];
  readonly notChecked: readonly string[];
}

export interface Settlement {
  readonly contractId: string;
  readonly agreed: number;
  /** What actually moved. A rejected delivery settles at zero. */
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
