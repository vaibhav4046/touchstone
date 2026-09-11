import type { Address } from "@aicoo/sharedos";

/** The one namespace Touchstone operates in during the Arena. */
export const NAMESPACE = "arena";

/** Arena participant identity. */
export const ARENA_NAME = "touchstone";

/** SharedOS service name and identity. It is the issuer and owner of assay resources. */
export const SHAREDOS_NAME = "yuzu";
export const YUZU: Address = { kind: "service", serviceId: "yuzu" };
export const TOUCHSTONE: Address = YUZU;
export const SHAREDOS_SERVICE: Address = YUZU;

/** Resource plane owned by Yuzu in SharedOS. Not files: assays are not a filesystem. */
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

export function buyerAddress(agentId?: string): Address {
  const id = typeof agentId === "string" && agentId.trim().length > 0 ? agentId.trim() : "anonymous-buyer";
  return { kind: "agent", agentId: id };
}

/** Stable, path-safe slug. Resource path segments reject separators and traversal markers. */
export function slug(input: string): string {
  const cleaned = (typeof input === "string" ? input : "")
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
