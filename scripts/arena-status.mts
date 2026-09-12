/**
 * Is Yuzu actually in the Room, and has anybody paid?
 *
 * One command that answers the two questions that decide the night, from the
 * server's point of view rather than from a log we wrote ourselves. A process
 * that prints "listening" while the server thinks the seat went offline forty
 * minutes ago is the failure this exists to catch.
 *
 *   node --env-file=.env.local --import tsx scripts/arena-status.mts
 */
const BASE = process.env.SHAREDNET_BASE ?? "https://www.sharednet.ai";
const ROOM = process.env.SHAREDNET_ROOM ?? "rom_TxTzqEUKyx";
const TOKEN = process.env.SHAREDNET_INSTANCE_TOKEN ?? process.env.SHAREDNET_MEMBER_TOKEN ?? "";
const YUZU = (process.env.YUZU_BASE_URL ?? "https://yuzu-market.vercel.app").replace(/\/$/, "");

if (TOKEN === "") {
  console.error("No SHAREDNET_INSTANCE_TOKEN. Run with --env-file=.env.local");
  process.exit(1);
}

const auth = { authorization: `Bearer ${TOKEN}` };

async function get<T>(path: string): Promise<T | undefined> {
  try {
    const response = await fetch(`${BASE}${path}`, { headers: auth });
    if (!response.ok) {
      console.log(`  ${path} -> ${response.status}`);
      return undefined;
    }
    return (await response.json()) as T;
  } catch (error) {
    console.log(`  ${path} -> unreachable (${error instanceof Error ? error.message : "unknown"})`);
    return undefined;
  }
}

const seat = await get<{ instance?: { id?: string; last_seen_at?: string }; agent?: { id?: string; handle?: string } }>(
  "/api/v1/instances/current",
);
const purse = await get<{ credits?: { balance: number; granted: number; sent: number; received: number } }>(
  "/api/v1/credits",
);
const rooms = await get<{ items?: { id: string; name: string }[] }>("/api/v1/rooms");
const recent = await get<{ items?: { sequence: number; content: string; sender_instance_id?: string }[] }>(
  `/api/v1/rooms/${ROOM}/messages?order=desc&limit=15`,
);

const lastSeen = seat?.instance?.last_seen_at;
const secondsAgo = lastSeen === undefined ? undefined : Math.round((Date.now() - Date.parse(lastSeen)) / 1000);

console.log("\nSEAT");
console.log(`  instance    ${seat?.instance?.id ?? "unknown"}`);
console.log(`  tagged      ${seat?.agent?.handle ?? "untagged"} (${seat?.agent?.id ?? "-"})`);
console.log(
  `  last seen   ${lastSeen ?? "never"}` +
    (secondsAgo === undefined
      ? ""
      : `  (${secondsAgo}s ago${secondsAgo > 90 ? " — PAST THE 90s LEASE, the agent is not running" : ""})`),
);
console.log(`  in room     ${(rooms?.items ?? []).some((room) => room.id === ROOM) ? "yes" : "NO"}`);

console.log("\nPURSE");
const credits = purse?.credits;
console.log(`  balance ${credits?.balance ?? "?"}   granted ${credits?.granted ?? "?"}   sent ${credits?.sent ?? "?"}`);
console.log(`  received ${credits?.received ?? "?"}   <- this is the Top Earner number`);

// What other agents have actually been saying, and whether any of it was ours
// to answer. A quiet room is a different problem from a room we are ignoring.
const items = (recent?.items ?? []).slice().reverse();
const ours = items.filter((message) => message.sender_instance_id === seat?.instance?.id);
const requests = items.filter((message) => /counterparty\.service\.request/i.test(message.content ?? ""));
const mentions = items.filter((message) => /yuzu/i.test(message.content ?? ""));

console.log("\nROOM (last 15)");
console.log(`  service requests ${requests.length}   mentioning yuzu ${mentions.length}   posted by us ${ours.length}`);
for (const message of items.slice(-5)) {
  const mine = message.sender_instance_id === seat?.instance?.id ? "*" : " ";
  console.log(`  ${mine}#${message.sequence} ${(message.content ?? "").slice(0, 96).replace(/\s+/g, " ")}`);
}

// The product has to answer too. A present agent in front of a dead market is
// the same as an absent one, and this is the endpoint the agent card sells.
console.log("\nPRODUCT");
try {
  const started = Date.now();
  const response = await fetch(`${YUZU}/api/assay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      vendor: "StatusCheck",
      pitch:
        "StatusCheck renders one 9:16 video per request. Price: 6 Arena credits. Delivery under 180 seconds. " +
        "Output: an MP4 URL plus the shot list as JSON. Samples: https://github.com/example/statuscheck",
      askingPrice: 6,
    }),
  });
  const body = (await response.json()) as { verdict?: string; score?: number; headline?: string };
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`  POST ${YUZU}/api/assay -> ${response.status} ${body.verdict ?? "?"} ${body.score ?? "?"} in ${seconds}s`);
  if (body.verdict === "UNPROVEN" || /denied|refused/i.test(body.headline ?? "")) {
    console.log(`  WARNING: ${body.headline}`);
  }
} catch (error) {
  console.log(`  POST ${YUZU}/api/assay -> unreachable (${error instanceof Error ? error.message : "unknown"})`);
}
console.log("");
