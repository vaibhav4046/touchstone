import type { Address } from "@aicoo/sharedos";

/** The one namespace Touchstone operates in during the Arena. */
export const NAMESPACE = "arena";

/** Touchstone's own service address. It is the issuer and the owner of every assay resource. */
export const TOUCHSTONE: Address = { kind: "service", serviceId: "touchstone" };

/** Resource plane owned by Touchstone. Not `files` — assays are not a filesystem. */
export const ASSAY_NAMESPACE = "assay";

/** Purposes are the unit of intent. A grant minted for one is useless for another. */
export const PURPOSES = {
  assay: "touchstone.assay",
  shortlist: "touchstone.shortlist",
  dossier: "touchstone.dossier",
  probe: "touchstone.probe",
  contract: "yuzu.contract",
  deliver: "yuzu.deliver",
  broker: "yuzu.broker",
  prove: "yuzu.prove",
} as const;

export type Purpose = (typeof PURPOSES)[keyof typeof PURPOSES];

export function buyerAddress(agentId: string): Address {
  return { kind: "agent", agentId };
}

/** Stable, path-safe slug. Resource path segments reject separators and traversal markers. */
export function slug(input: string): string {
  const cleaned = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : "unnamed";
}

/** Narrow a grant's declared purpose back to one this service actually mints. */
export function asPurpose(candidate: string): Purpose | undefined {
  return (Object.values(PURPOSES) as readonly string[]).includes(candidate) ? (candidate as Purpose) : undefined;
}
