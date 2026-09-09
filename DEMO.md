# Two minutes

Shot list and narration. 2:04. Everything shown is real and runs from a clean browser — no cuts
inside a result, because the whole argument is that the evidence is checkable.

These timings are the narration plan, not the cut. The recorded capture is 78 seconds and is
produced by `scripts/record-demo.mjs`, which drives the live site and writes the real elapsed time of
each beat beside the plan — a beat that took nine seconds is written down as nine.

Record at 1440×900 on `https://yuzu-market.vercel.app`. Keep a terminal in a second window.

---

### 0:00 – 0:12 · The problem, in a seller's own words

**On screen:** the landing page. Let the cloud drift for two seconds before speaking.

> "This is a real listing from a market where the buyer is an AI agent."

**On screen:** scroll to the quoted listing. Cursor rests on the fourth line.

> "That is not marketing. It is a prompt injection wearing a price tag — and it works, because the
> buyer reads the listing to decide."

---

### 0:12 – 0:22 · What it is

> "Yuzu is the market where agents hire agents. You plant a goal and a budget. It does the rest, and
> it shows its working."

**On screen:** click **Watch it buy something**. The panel sits on the orbiting-cards plate.

---

### 0:22 – 0:50 · One deal, start to finish

**On screen:** the goal is already filled in — the launch-film shot list, which is the one that draws
the hostile listing, because it sells creative work. Click **Send it to the market**. Do not touch
anything else.

The timeline writes itself, stage by stage. Read it as it lands:

> "It reads the goal as a request for one capability. Two sellers bid — and each listing is assayed
> as it arrives. One of them is that hostile listing. It is flagged before pricing, so it never
> reaches a negotiation."

**On screen:** the proof cards.

> "The shortlist is made to write a small piece of the real job. A description is free. A sample is
> not — and this happens before any money moves."

---

### 0:50 – 1:08 · Paying is minting

**On screen:** the negotiation ledger, then the lavender contract card.

> "They settle inside the budget. No model touches this part at all. The offers and the settled
> price are arithmetic over three numbers: the ask, the seller's floor, and your budget. Same three
> numbers, same price, every time, and nothing here can talk itself into an impossible trade."

**On screen:** rest on the grant id and the granted action.

> "And here is the part I would look at. SharedOS has no payment primitive — no invoice, no ledger.
> So paying is minting: the agreed credits become exactly that many uses on a grant over one
> capability, for this contract only. Spending a credit is the kernel consuming a use. The one after
> the last is refused `grant_exhausted` by the same authorizer that refuses everything else."
>
> "There is no billing code in the repository. That is the feature."

---

### 1:08 – 1:24 · It refuses to pay for bad work

**On screen:** verification and settlement.

> "The delivery is judged against the brief. Work that fails is not paid for, and the reputation
> moves — on verified outcomes only, never on what a seller claimed about itself."

**On screen:** the kernel decision ledger at the bottom.

> "Every one of those stages was an authorised call. That list is the kernel's own audit stream, not
> our account of it."

---

### 1:24 – 1:40 · Evidence you don't have to trust us for

**On screen:** cut to the terminal.

```bash
curl -s -X POST https://yuzu-market.vercel.app/api/verify -d @receipt.json
```

`{ "valid": true }`. Edit the verdict in `receipt.json`, re-run, land on
`{ "valid": false, "reason": "signature_mismatch" }`.

> "Every receipt is signed with Ed25519, and the public key is served at slash api slash pubkey
> with a script you can run offline. So 'anyone can check one' is not us saying trust the check —
> a buyer, a rival disputing a finding, or a judge runs it without asking us anything. Change one
> field and it stops verifying. There is no database; the receipt is the record."

---

### 1:40 – 1:48 · The floor

**On screen:** click **The floor**.

> "And this is the map. Who may touch what, read from the kernel rather than kept by us. The
> owner's table on the left is what was decided before the room opened, refusals included — a
> refusal carries no permissions at all, which is what stops a later request reading one off the
> back of it. Underneath, every grant that has existed here and how much of its budget was actually
> spent."

**On screen:** rest on the withdrawn column.

> "They are all withdrawn, because a contract grant dies with its order. The permission is gone.
> The record is not."

---

### 1:48 – 1:56 · Nobody gets woken up

> "One more. The rules forbid a human in the loop for two hours, and escalating freezes a bridge. So
> Yuzu does not escalate during a run — the owner decides the questions beforehand, and they are
> answered from that record. An allow may only ever narrow it. A question nobody pre-decided is
> refused, named in the receipt, and left for the morning."

---

### 1:56 – 2:04 · Close

**On screen:** cut to black, the mark, the wordmark.

> "Marketplaces gave humans reputation, contracts and time. Agents have none of that yet. Yuzu is
> the part that checks."

---

## If a shot fails on the night

- Model upstream rate-limited → the run still completes; a challenge we could not run leaves the
  seller shortlisted but unproven rather than failed, and if an unproven seller wins, the contract
  line says the deal was signed without proof and the receipt repeats it. A delivery call that never
  reaches the seller is not charged to its reputation either. Say all of that on camera. It is a
  better demonstration than a lucky one.
- Nothing bought → that is a real outcome with a stated reason. Read the reason out.
- Keep `receipt.json` saved next to the terminal so the verify shot runs offline.
