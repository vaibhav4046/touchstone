import { after } from "next/server";
import { arenaState, roundFanout, runRound, type Candidate } from "../../../lib/arena/participant";
import { ledger } from "../../../lib/arena/ledger";
import { drainAudit } from "../../../lib/sharedos/host";
import { MAX_FANOUT, admit, fanOutTooLarge, json, rateLimited } from "../../../lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * The Arena participant, driven by one call per round.
 *
 * POST starts a round and returns when the round is finished, so an organiser
 * or a scheduler can fire it and read the result; nothing here waits on a human
 * and no branch asks for one. GET is the standing position — ledger and
 * ranking — for anyone who wants to check compliance without starting anything.
 */
export async function POST(request: Request): Promise<Response> {
  after(async () => drainAudit());

  // `admit` was imported here and never called, which is the worst shape for
  // this bug: it reads as guarded. A round assays and trials every candidate
  // supplied, so an unguarded POST is a fan-out of billed model calls that
  // anyone on the internet can start.
  const admission = admit(request);
  if (!admission.ok) return rateLimited(admission);

  const raw = await request.text();
  let body: { round?: unknown; candidates?: unknown } = {};
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    body = {};
  }

  const round = body.round === 1 || body.round === 2 ? body.round : undefined;
  if (round === undefined) {
    return json(
      {
        error: "no_round",
        message:
          'Send {"round":1,"candidates":[{"name":"...","pitch":"their words","endpoint":"https://...","price":6}]}. Round 1 trials, critiques and ranks; round 2 spends.',
      },
      400,
    );
  }

  const result = await runRound({ round, candidates: candidatesFrom(body.candidates) });
  return json(result);
}

export async function GET(): Promise<Response> {
  const state = arenaState();
  return json({
    service: "arena",
    method: "POST",
    body: { round: "1 | 2", candidates: "[{ name, pitch, endpoint?, price? }] — optional; a short list is topped up from the registry" },
    ledger: ledger(),
    ranking:
      state === undefined
        ? []
        : state.ranking.map((entry) => ({
            rank: entry.rank,
            product: entry.product,
            standing: entry.standing,
            verdict: entry.verdict,
            reason: entry.reason,
            disagreements: entry.critique.disagreements,
          })),
    lastRoundAt: state?.at,
    post: state?.post,
  });
}

function candidatesFrom(value: unknown): readonly Candidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as { name?: unknown; pitch?: unknown; endpoint?: unknown; price?: unknown };
    if (typeof record.name !== "string" || record.name.trim().length === 0) return [];
    return [
      {
        name: record.name.trim(),
        pitch: typeof record.pitch === "string" ? record.pitch : "",
        endpoint: typeof record.endpoint === "string" ? record.endpoint : undefined,
        price: typeof record.price === "number" && Number.isFinite(record.price) ? record.price : undefined,
      } satisfies Candidate,
    ];
  });
}
