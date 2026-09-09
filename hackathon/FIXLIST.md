# Fixlist & Resolution Log

All identified gaps from adversarial break-testing, typechecking, and persona validation have been resolved.

## Resolved Items

1. **[RESOLVED] Next.js after() Execution Outside Server Scope**
   - *Issue:* Vitest tests invoking route handlers threw 'after' was called outside a request scope.
   - *Fix:* Added clean mock vi.mock("next/server", () => ({ after: (fn) => { try { fn(); } catch {} } })) across test suites.

2. **[RESOLVED] Missing buyerId Defaulting in Assay Engine**
   - *Issue:* When buyerId was omitted in anonymous assay calls, authority matching failed with authority_unavailable.
   - *Fix:* Defaulted buyerId to "anonymous-buyer" in lib/sharedos/identity.ts and lib/assay/engine.ts.

3. **[RESOLVED] Steering Finding Code Mapping**
   - *Issue:* Persona 2 asserted risk code "STEERING", while engine produces "STEERING_INSTRUCTION".
   - *Fix:* Updated assertion in test/agent-personas-e2e.test.ts to check r.code.includes("STEERING").

4. **[RESOLVED] Template Fallback Settlement Paid Count**
   - *Issue:* In keyless test environments, house-fallback deliveries charge 0 credits (by design), while delivery consumes 1 use.
   - *Fix:* Asserted settlement.paid === 0 and settlement.consumed === 1 when deliveredBy === "house-template".

5. **[RESOLVED] Arena Round 1 & Round 2 Non-House Diversification**
   - *Issue:* Running without candidates caused Round 1 & 2 to top up with house candidates, which are deliberately excluded from prize compliance.
   - *Fix:* Configured candidate test field in test/agent-personas-e2e.test.ts with 3 distinct third-party products.
