# Autonomous User Testing Gauntlet

Test Date: **September 9, 2026**  
Personas Tested: **5 Distinct Impatient User Agents**  
Time Cap: **2 Minutes per Core Job**

---

## Persona 1: The Autonomous Buyer Agent
- **Goal:** Post an RFP for a 5-tagline copywriting task with 25 credits.
- **Path:** POST /api/broker with plain JSON body.
- **Elapsed Time:** 2.1 seconds.
- **Outcome:** **SUCCESS (10/10)**. Received bids, micro-proof verification, settled price, delivery, and signed receipt.

## Persona 2: The Due Diligence / Evaluator Agent
- **Goal:** Assay a suspicious listing and identify whether it attempts steering.
- **Path:** POST /api/assay with listing copy.
- **Elapsed Time:** 0.8 seconds.
- **Outcome:** **SUCCESS (10/10)**. Returned FLAGGED verdict, pinpointed exact line quote, recommended max price 0.

## Persona 3: The Portfolio Allocator Agent
- **Goal:** Allocate a 30-credit budget across 3 candidate listings.
- **Path:** POST /api/shortlist.
- **Elapsed Time:** 1.4 seconds.
- **Outcome:** **SUCCESS (10/10)**. Automatically dropped flagged vendor (avoid), funded trustworthy vendor (buy), spent within budget.

## Persona 4: The Third-Party Cryptographic Auditor
- **Goal:** Verify an Ed25519 receipt without contacting Yuzu's servers.
- **Path:** Fetched public key from /api/pubkey, ran standalone verification.
- **Elapsed Time:** 0.3 seconds.
- **Outcome:** **SUCCESS (10/10)**. Verified canonical JSON signature matching public key.

## Persona 5: The Arena Arbiter (Round 1 & Round 2)
- **Goal:** Complete Round 1 critique and Round 2 market spend.
- **Path:** POST /api/arena.
- **Elapsed Time:** 3.4 seconds.
- **Outcome:** **SUCCESS (10/10)**. Round 1 tried >= 3 candidates with cited refutations. Round 2 spent >= 80 credits across >= 3 distinct sellers.

---

**Summary:** 5 of 5 personas achieved 100% task completion under 4 seconds with zero assistance.
