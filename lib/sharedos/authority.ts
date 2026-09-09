import type { AccessContext, Address, CapabilityGrant } from "@aicoo/sharedos";
import type { DelegationChainResolver, GrantSource } from "@aicoo/sharedos";
import { addressesEqual } from "@aicoo/sharedos";

/**
 * Where authority comes from, now that a caller cannot carry it.
 *
 * Until alpha.5 the host put grants straight onto `AccessContext` and the
 * kernel decided against whatever was there. A `GrantSource` is a better shape
 * for the same idea and a stricter one: the kernel loads authority itself, once
 * per turn, from a place the caller cannot reach. Nothing an agent sends can
 * become a grant even by accident, because the field it would have to set no
 * longer exists.
 *
 * Touchstone's store is in-process because its grants are: one order mints one
 * grant, that grant outlives nothing but the order, and there is no standing
 * authority to keep anywhere. A host with durable delegation would put a
 * database behind this interface instead — the kernel cannot tell the
 * difference, which is the point of the port.
 */
declare global {
  // eslint-disable-next-line no-var
  var __touchstoneGrants: Map<string, CapabilityGrant[]> | undefined;
}

const grants: Map<string, CapabilityGrant[]> = (globalThis.__touchstoneGrants ??= new Map());

/**
 * A grant that existed, after it has stopped existing.
 *
 * Authority is withdrawn the moment its order closes, which is the correct
 * lifetime and also the reason a grant map read a minute later is empty. The
 * permission is gone; the record of it should not be. This is the record: what
 * was authorised, how much of the budget was actually spent, and how it ended.
 *
 * It is deliberately not authority. Nothing loads a grant from here, and
 * `createGrantSource` never reads it -- a store the kernel consults and a store
 * an auditor reads have different jobs and collapsing them is how a revoked
 * permission comes back to life.
 */
export interface GrantRecord {
  readonly id: string;
  readonly subject: string;
  readonly capabilities: readonly { resource: string; actions: readonly string[]; scope: string }[];
  readonly purposes: readonly string[];
  readonly maxUses?: number;
  readonly parentGrantId?: string;
  readonly openedAt: string;
  closedAt?: string;
  ending?: "withdrawn" | "expired";
}

declare global {
  // eslint-disable-next-line no-var
  var __touchstoneGrantLog: GrantRecord[] | undefined;
}

const log: GrantRecord[] = (globalThis.__touchstoneGrantLog ??= []);

/** Newest first. Capped, because this is a demonstration and not a database. */
export function grantHistory(limit = 24): readonly GrantRecord[] {
  return log.slice(-limit).reverse();
}

function note(grant: CapabilityGrant): void {
  if (log.some((entry) => entry.id === grant.id)) return;
  log.push({
    id: grant.id,
    subject: addressId(grant.subject),
    capabilities: grant.capabilities.map((capability) => ({
      resource: `${capability.resource.namespace}/${capability.resource.path.join("/")}`,
      actions: capability.actions,
      scope: capability.scope,
    })),
    purposes: grant.constraints.purposes ?? [],
    maxUses: grant.constraints.maxUses,
    parentGrantId: grant.parentGrantId,
    openedAt: new Date().toISOString(),
  });
  if (log.length > 200) log.splice(0, log.length - 200);
}

function close(grantId: string, ending: "withdrawn" | "expired"): void {
  const entry = log.find((row) => row.id === grantId && row.closedAt === undefined);
  if (entry === undefined) return;
  entry.closedAt = new Date().toISOString();
  entry.ending = ending;
}

function keyOf(namespaceId: string, subjectId: string): string {
  return `${namespaceId}::${subjectId}`;
}

function addressId(subject: Address): string {
  switch (subject.kind) {
    case "agent":
      return `agent:${subject.agentId}`;
    case "human":
      return `human:${subject.userId}`;
    case "service":
      return `service:${subject.serviceId}`;
    case "group":
      return `group:${subject.conversationId}`;
  }
}

function subjectIdOf(grant: CapabilityGrant): string {
  return addressId(grant.subject);
}

function actorIdOf(context: AccessContext): string {
  const actor = context.actor;
  switch (actor.kind) {
    case "agent":
      return `agent:${actor.agentId}`;
    case "human":
      return `human:${actor.userId}`;
    case "service":
      return `service:${actor.serviceId}`;
    case "group":
      return `group:${actor.conversationId}`;
  }
}

/**
 * Hold a grant for as long as the order that minted it runs.
 *
 * `record: false` is for authority whose whole life is one read: a directory
 * grant is minted, one card is read against it, and it is withdrawn in the same
 * function. Its opening and its closing are the same event, and `grantHistory`
 * is a capped list of authority over the market — a row per page view would
 * push the contract grants a reader came to see out of it. Nothing is hidden by
 * this: the read those grants carry is audited by the kernel as
 * `authorization.checked`, which is the record that says whether it was allowed.
 */
export function depositGrant(grant: CapabilityGrant, options: { readonly record?: boolean } = {}): void {
  sweep();
  if (options.record !== false) note(grant);
  const key = keyOf(grant.namespaceId, subjectIdOf(grant));
  const held = grants.get(key) ?? [];
  grants.set(key, [...held.filter((existing) => existing.id !== grant.id), grant]);
}

/**
 * What one subject is currently holding.
 *
 * Read-only and non-consuming, for the console and the grant map. The kernel's
 * `reach` is the better answer to "where may this actor operate" because it has
 * already resolved delegation and stripped the authority out; this is the other
 * half of the same picture -- the grants themselves, with their budgets, so a
 * reader can see how much of a bounded permission is left rather than only that
 * it exists.
 */
export function heldGrants(namespaceId: string, subject: Address): readonly CapabilityGrant[] {
  sweep();
  return grants.get(keyOf(namespaceId, addressId(subject))) ?? [];
}

export function withdrawGrant(grantId: string): void {
  close(grantId, "withdrawn");
  for (const [key, held] of grants) {
    const remaining = held.filter((grant) => grant.id !== grantId);
    if (remaining.length === 0) grants.delete(key);
    else if (remaining.length !== held.length) grants.set(key, remaining);
  }
}

/**
 * Expired grants are dropped here as well as refused by the kernel.
 *
 * The kernel would refuse them anyway — this is not the enforcement. It is
 * housekeeping, so a long-running process does not accumulate every grant it
 * ever minted in memory that nothing will ever read again.
 */
function sweep(): void {
  const now = Date.now();
  for (const [key, held] of grants) {
    const live = held.filter((grant) => {
      const expiresAt = grant.constraints.expiresAt;
      const alive = expiresAt === undefined || Date.parse(expiresAt) > now;
      if (!alive) close(grant.id, "expired");
      return alive;
    });
    if (live.length === 0) grants.delete(key);
    else if (live.length !== held.length) grants.set(key, live);
  }
}

export function createGrantSource(): GrantSource {
  return {
    async load(context: AccessContext): Promise<readonly CapabilityGrant[]> {
      sweep();
      const held = grants.get(keyOf(context.namespaceId, actorIdOf(context))) ?? [];
      // Return what this actor holds and let the kernel decide. Filtering by
      // purpose or resource here would be policy wearing an authority costume,
      // and the two are meant to be separable: the ceiling narrows, the grant
      // authorizes, and neither is allowed to do the other's job.
      return held.filter((grant) => addressesEqual(grant.issuer, context.authority));
    },
  };
}

/**
 * Ancestors, resolved from the store rather than from the child.
 *
 * A derived grant names its parent but cannot be trusted to describe it, so the
 * kernel re-reads the ancestor here. Without this port a grant that claims a
 * parent authorizes nothing at all — which is the correct default, and the
 * reason a contract grant derived from the shelf was refused on its very first
 * delivery until this existed.
 */
export function createDelegationResolver(): DelegationChainResolver {
  return {
    async resolve(namespaceId: string, grantId: string): Promise<CapabilityGrant | undefined> {
      for (const held of grants.values()) {
        for (const grant of held) {
          if (grant.namespaceId === namespaceId && grant.id === grantId) return grant;
        }
      }
      return undefined;
    },
  };
}
