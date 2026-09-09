import { CARD_VIEWS } from "../../../lib/sharedos/directory";
import { json, resolveBuyer } from "../../../lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * There is no agent listing, and that is the feature.
 *
 * The obvious thing for a marketplace to serve here is every agent it knows
 * about. SharedOS gates a single card read for precisely that reason: the
 * capability that answers in bulk is `directoryCapability`, the kernel calls it
 * "the enumeration grant", and it says holding one is what makes the directory
 * answer "does this agent exist" wholesale. Yuzu issues no such grant to
 * anybody, so this route has nothing to enumerate — not because a filter is
 * missing but because the authority is.
 *
 * Ask for one card at a time instead, and be refused one at a time.
 */
export function GET(request: Request): Response {
  const you = resolveBuyer(request);
  return json({
    listing: null,
    reason: "no_enumeration_grant",
    message:
      "Yuzu serves cards one agent at a time. A directory that lists its members is the enumeration oracle the " +
      "kernel's gate on card reads exists to refuse, and no actor here holds the grant that would answer in bulk.",
    you,
    readYourOwnCard: `/api/agents/${you}`,
    readSomebodyElses: "/api/agents/<id>?view=identity",
    views: CARD_VIEWS,
    grantMap: "/api/grants",
  });
}
