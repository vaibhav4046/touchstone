import { describe, expect, it } from "vitest";
import { blockedHostRefusal, isBlockedHost } from "../lib/sharedos/tools";

/**
 * The hole the literal-host check left open.
 *
 * `isBlockedHost` reads the hostname as written, so `169.254.169.254` was
 * refused and `metadata.attacker.example` was not — even when that name has a
 * static A record pointing straight at it. No rebinding, no timing, just a DNS
 * record an attacker controls. Both the probe tool and the Arena participant
 * fetch caller-supplied URLs from our server and hand part of the response
 * back, so the name has to be resolved and every address it resolves to has to
 * be checked before the request is made.
 *
 * These drive the injected resolver rather than real DNS: the point under test
 * is what the guard does with an answer, and a test that needed the internet to
 * decide whether we are secure would be neither fast nor honest.
 */
const resolvesTo = (...addresses: readonly string[]) => async () => addresses.map((address) => ({ address }));

describe("a name is judged by what it resolves to, not by how it is spelled", () => {
  it("refuses a perfectly ordinary hostname whose record points at cloud metadata", async () => {
    const refusal = await blockedHostRefusal("assets.attacker.example", resolvesTo("169.254.169.254"));

    expect(refusal).toBeDefined();
    expect(refusal?.kind).toBe("blocked");
    expect(refusal?.code).toBe("endpoint_resolves_to_blocked");
    // The message has to name the address, because "your endpoint was refused"
    // is indistinguishable from a bug to whoever published it in good faith.
    expect(refusal?.message).toContain("169.254.169.254");
  });

  it("refuses one that resolves into a private range, and one that resolves to loopback", async () => {
    for (const address of ["10.0.0.5", "127.0.0.1", "192.168.1.1", "172.16.4.4", "::1"]) {
      const refusal = await blockedHostRefusal("seller.example", resolvesTo(address));
      expect(refusal?.kind, `${address} must be refused`).toBe("blocked");
    }
  });

  it("refuses when any one of several answers is private", async () => {
    // A name can answer with a public address and a private one. Checking only
    // the first is a coin flip, and the connection may take either.
    const refusal = await blockedHostRefusal("split.example", resolvesTo("93.184.216.34", "10.1.2.3"));

    expect(refusal?.kind).toBe("blocked");
    expect(refusal?.message).toContain("10.1.2.3");
  });

  it("allows a name that resolves only to public addresses", async () => {
    expect(await blockedHostRefusal("example.com", resolvesTo("93.184.216.34"))).toBeUndefined();
  });

  it("refuses a name that does not resolve rather than handing it to fetch", async () => {
    const thrown = await blockedHostRefusal("nope.invalid", async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    });
    expect(thrown?.kind).toBe("unresolvable");

    // An empty answer is the same fact in a different shape, and must not fall
    // through to an allow.
    expect((await blockedHostRefusal("empty.invalid", resolvesTo()))?.kind).toBe("unresolvable");
  });

  it("still refuses a literal private address without consulting DNS at all", async () => {
    const refusal = await blockedHostRefusal("169.254.169.254", async () => {
      throw new Error("the resolver must not be reached for a literal address");
    });

    expect(refusal?.code).toBe("endpoint_host_blocked");
    expect(isBlockedHost("169.254.169.254")).toBe(true);
  });
});
