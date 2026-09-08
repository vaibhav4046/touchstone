import type { AccessContext, CapabilityGrant } from "@aicoo/sharedos";
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

function keyOf(namespaceId: string, subjectId: string): string {
  return `${namespaceId}::${subjectId}`;
}

function subjectIdOf(grant: CapabilityGrant): string {
  const subject = grant.subject;
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

/** Hold a grant for as long as the order that minted it runs. */
export function depositGrant(grant: CapabilityGrant): void {
  sweep();
  const key = keyOf(grant.namespaceId, subjectIdOf(grant));
  const held = grants.get(key) ?? [];
  grants.set(key, [...held.filter((existing) => existing.id !== grant.id), grant]);
}

export function withdrawGrant(grantId: string): void {
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
      return expiresAt === undefined || Date.parse(expiresAt) > now;
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
