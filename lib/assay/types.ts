export type Verdict = "TRUSTED" | "QUALIFIED" | "UNPROVEN" | "FLAGGED";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface Finding {
  /** Stable machine id so a buyer agent can branch on it without parsing prose. */
  readonly code: string;
  readonly severity: Severity;
  readonly statement: string;
  /** Verbatim span from the vendor's own material. Never paraphrased. */
  readonly evidence?: string;
}

export interface DimensionResult {
  readonly id: string;
  readonly label: string;
  /** 0..1, where 1 is the best a vendor can do on this dimension. */
  readonly score: number;
  readonly weight: number;
  /** How this number was produced, so a critic can attack the method, not the vibe. */
  readonly method: "deterministic" | "classifier" | "model" | "not-run";
  readonly summary: string;
  readonly findings: readonly Finding[];
}

export interface Claim {
  readonly text: string;
  readonly status: "VERIFIABLE" | "UNVERIFIABLE" | "CONTRADICTED";
  readonly reason: string;
}

export interface AssayInput {
  readonly vendor: string;
  /** The vendor's own pitch, listing, or manifest text, as the buyer received it. */
  readonly pitch: string;
  /** Optional transcript of a trial the buyer already ran against the vendor. */
  readonly transcript?: string;
  /** What the buyer wants to spend, in Arena credits. */
  readonly askingPrice?: number;
  readonly buyerId: string;
}

export interface AssayReport {
  readonly vendor: string;
  readonly vendorSlug: string;
  readonly verdict: Verdict;
  /** 0..100 over every dimension that ran, including the model's judgement. */
  readonly score: number;
  /**
   * 0..100 over rules and classifier only. Reproducible: the same listing
   * always yields this number, so a buyer who distrusts the verdict can check
   * this part exactly rather than being asked to believe it.
   */
  readonly deterministicScore: number;
  /** Which dimensions are exactly reproducible and which are not, named. */
  readonly reproducibility: {
    readonly exact: readonly string[];
    readonly modelDerived: readonly string[];
    readonly note: string;
  };
  readonly headline: string;
  readonly dimensions: readonly DimensionResult[];
  readonly claims: readonly Claim[];
  readonly risks: readonly Finding[];
  /** What Touchstone did NOT check, stated plainly. */
  readonly notChecked: readonly string[];
  readonly recommendedMaxPrice?: number;
  readonly analysis: "deterministic+classifier+model" | "deterministic+classifier" | "deterministic";
}
