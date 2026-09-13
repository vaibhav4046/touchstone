/**
 * Who is earning in this Room, how much, and for what.
 *
 * The Arena is won by whoever other agents spend the most on, and that number
 * is partly public: this Room settles in the open, with a transfer followed by
 * an announcement ("Paid 7 credits to p_zn1vNpB1lD - memo (txn_...)"). Nobody's
 * balance is readable, but every payment somebody chose to announce is, and so
 * is every price anybody advertised.
 *
 * So this reads the whole log and builds three things from it:
 *
 *   1. A leaderboard of announced payments by payee. Lower bound, never a
 *      balance: a payment made quietly is invisible here and is not guessed at.
 *   2. Every service and price anybody has advertised, so Yuzu's ladder can be
 *      compared against the real field rather than against an assumption.
 *   3. What was asked for and never answered -- the demand nobody served.
 *
 * Everything here comes from messages any member can read. Nothing is inferred
 * about another agent's purse, because we cannot see it and a number we cannot
 * source is exactly what this product exists to refuse.
 *
 *   node --env-file=.env.local --import tsx scripts/arena-intel.mts
 */
const BASE = process.env.SHAREDNET_BASE ?? "https://www.sharednet.ai";
const ROOM = process.env.SHAREDNET_ROOM ?? "rom_TxTzqEUKyx";
const TOKEN = process.env.SHAREDNET_INSTANCE_TOKEN ?? process.env.SHAREDNET_MEMBER_TOKEN ?? "";
// Every identity that is us, including the buyer seat minted for transport
// checks. Leaving that one out is what made the first demand number wrong.
const US = new Set(["p_FjHUKCzfcH", "a_cIP4zDMZBh", "i_1TrFG0Boy9", "i_Ey25rD9iym", "i_yG9BNsV3bR"]);

if (TOKEN === "") {
  console.error("No SHAREDNET_INSTANCE_TOKEN. Run with --env-file=.env.local");
  process.exit(1);
}

interface Message {
  readonly sequence: number;
  readonly content: string;
  readonly sender_instance_id?: string;
  readonly created_at?: string;
}

/** The whole log, oldest first, paged. */
async function history(): Promise<Message[]> {
  const all: Message[] = [];
  let after = 0;
  for (let page = 0; page < 40; page += 1) {
    const response = await fetch(`${BASE}/api/v1/rooms/${ROOM}/messages?after=${after}&limit=100`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    if (!response.ok) break;
    const body = (await response.json()) as { items?: Message[]; has_more?: boolean };
    const items = body.items ?? [];
    all.push(...items);
    if (items.length === 0 || body.has_more !== true) break;
    after = items[items.length - 1].sequence;
  }
  return all;
}

const PAID = /\bpaid\s+(\d+)\s+credits?\s+to\s+(p_[A-Za-z0-9]+|a_[A-Za-z0-9]+|i_[A-Za-z0-9]+)/gi;
// "probe is 8 credits", "3 credits per receipt", "assay 3", "5 Credits"
const PRICE = /\b([a-z][\w.\-]{2,28})\b[^.\n]{0,40}?\b(\d{1,3})\s*credits?\b/gi;
const ASKED = /"service"\s*:\s*"([a-z_]+)"/gi;

const log = await history();
console.log(`\nRoom ${ROOM}: ${log.length} messages read.\n`);

// ── who has been paid, in public ──────────────────────────────────────────
const earned = new Map<string, { credits: number; payments: number }>();
for (const message of log) {
  for (const hit of (message.content ?? "").matchAll(PAID)) {
    const amount = Number(hit[1]);
    const payee = hit[2];
    const row = earned.get(payee) ?? { credits: 0, payments: 0 };
    row.credits += amount;
    row.payments += 1;
    earned.set(payee, row);
  }
}

console.log("ANNOUNCED EARNINGS (a floor, not a balance; quiet payments are invisible)");
const board = [...earned.entries()].sort((left, right) => right[1].credits - left[1].credits);
if (board.length === 0) console.log("  nobody has announced a payment yet.");
for (const [payee, row] of board) {
  const mine = US.has(payee) ? "  <- us" : "";
  console.log(`  ${String(row.credits).padStart(4)} credits over ${row.payments} payment(s)  ${payee}${mine}`);
}
const ours = board.filter(([payee]) => US.has(payee)).reduce((sum, [, row]) => sum + row.credits, 0);
const leader = board[0];
console.log(
  `\n  Yuzu: ${ours}. ` +
    (leader === undefined
      ? "No leader yet, which means the field is still open."
      : US.has(leader[0])
        ? "Top of the announced board."
        : `Leader has ${leader[1].credits}; ${leader[1].credits - ours} to close.`),
);

// ── what everyone charges ─────────────────────────────────────────────────
console.log("\nADVERTISED PRICES (as stated by their own agents)");
const prices = new Map<string, Set<number>>();
for (const message of log) {
  if (US.has(message.sender_instance_id ?? "")) continue;
  for (const hit of (message.content ?? "").matchAll(PRICE)) {
    const name = hit[1].toLowerCase();
    if (/^(the|and|for|per|with|you|are|this|that|from|only|each|over|about|first|every|paid|pay|credits?)$/.test(name)) continue;
    const set = prices.get(name) ?? new Set<number>();
    set.add(Number(hit[2]));
    prices.set(name, set);
  }
}
const listed = [...prices.entries()]
  .filter(([, set]) => set.size <= 3)
  .sort((left, right) => Math.min(...left[1]) - Math.min(...right[1]))
  .slice(0, 22);
for (const [name, set] of listed) {
  console.log(`  ${[...set].sort((a, b) => a - b).join("/").padStart(7)} credits  ${name}`);
}
console.log("\n  Yuzu: assay 3, shortlist 10, broker 12. Free: sellers, verify_receipt, grant_map.");

// ── demand nobody served ──────────────────────────────────────────────────
/**
 * Demand means somebody else's demand.
 *
 * The first version of this counted every service request in the log, and the
 * number it produced was reported as evidence: "assay requested 8 times". Three
 * of those were Yuzu's own transport checks, sent from a seat we minted, and
 * once they are removed the independent demand for assay is zero. Counting our
 * own traffic as market interest is the most flattering possible error and
 * exactly the kind this product exists to catch in other people's listings.
 *
 * So ours are separated and both numbers are printed. A market that measures
 * itself by its own footsteps is not measuring anything.
 */
const asked = new Map<string, { independent: number; ours: number }>();
const requesters = new Set<string>();
for (const message of log) {
  const fromUs = US.has(message.sender_instance_id ?? "");
  for (const hit of (message.content ?? "").matchAll(ASKED)) {
    const row = asked.get(hit[1]) ?? { independent: 0, ours: 0 };
    if (fromUs) row.ours += 1;
    else {
      row.independent += 1;
      requesters.add(message.sender_instance_id ?? "?");
    }
    asked.set(hit[1], row);
  }
}

console.log("\nSERVICES REQUESTED IN-ROOM (independent / ours)");
const demand = [...asked.entries()].sort((left, right) => right[1].independent - left[1].independent);
if (demand.length === 0) console.log("  nothing has been requested yet.");
for (const [service, row] of demand) {
  console.log(`  ${String(row.independent).padStart(3)} independent  ${String(row.ours).padStart(3)} ours   ${service}`);
}
const independentTotal = demand.reduce((sum, [, row]) => sum + row.independent, 0);
console.log(
  `\n  ${independentTotal} independent request(s) from ${requesters.size} distinct agent(s). ` +
    (independentTotal === 0
      ? "No independent demand yet: the Arena has not opened."
      : "Anything Yuzu counts as traction has to come from these."),
);
console.log("");
