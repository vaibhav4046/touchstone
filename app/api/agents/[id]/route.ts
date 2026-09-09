import { after } from "next/server";
import { cardNamespaces, isCardView, readAgentCard, CARD_VIEWS } from "../../../../lib/sharedos/directory";
import { drainAudit, toolCatalogue } from "../../../../lib/sharedos/host";
import { buildContext } from "../../../../lib/sharedos/host";
import { PURPOSES } from "../../../../lib/sharedos/identity";
import { json, resolveBuyer } from "../../../../lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One agent's card, served by the kernel.
 *
 * A marketplace of agents that publishes no agent card is asking every
 * counterparty to take its word for who is who. This is the kernel's answer
 * instead of ours: `readAgentCard` derives the subject's reach from the grants
 * in force at this instant, and the read is authorized on the same path as any
 * other operation here.
 *
 *   GET /api/agents/<id>                  the reach card, if you are that agent
 *   GET /api/agents/<id>?view=identity    that agent exists and is addressable
 *   GET /api/agents/<id>?view=namespaces  which namespaces it reaches, no paths
 *
 * Who you are is the `x-agent-id` header, exactly as everywhere else in this
 * service. Ask for your own card and you are served the widest view; ask for a
 * stranger's and you are served `identity` and refused the rest — by the kernel,
 * which then names in `servableViews` what you may still ask for, so a narrow
 * reader learns it is narrow rather than concluding the agent is unreachable.
 *
 * A refusal is 200 and not 404. An agent that does not exist and an agent whose
 * card you may not read are answered identically and deliberately: a status code
 * that distinguished them would make this an existence oracle one refusal at a
 * time, which is the disclosure the gate on card reads exists to decline.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const subjectId = id.trim();
  if (subjectId.length === 0) {
    return json({ error: "no_subject", message: "Name the agent whose card you want: /api/agents/<id>." }, 400);
  }

  const readerId = resolveBuyer(request);
  const asked = new URL(request.url).searchParams.get("view");
  if (asked !== null && !isCardView(asked)) {
    return json(
      { error: "unknown_view", message: `A card is served as one of ${CARD_VIEWS.join(", ")}.`, views: CARD_VIEWS },
      400,
    );
  }

  const directory = await readAgentCard({
    readerId,
    subjectId,
    purpose: PURPOSES.broker,
    view: asked ?? undefined,
  });
  after(() => drainAudit());

  if (directory.read.status === "refused") {
    return json({
      subject: directory.subject,
      reader: directory.reader,
      requestedView: directory.requestedView,
      served: false,
      reasonCode: directory.read.reasonCode,
      servableViews: directory.read.servableViews,
      requiredAuthority: directory.read.requiredAuthority,
      note:
        directory.read.servableViews.length === 0
          ? "No view of this agent is yours to read. An agent that does not exist answers exactly the same way."
          : `Ask again with ?view=${directory.read.servableViews[0]}.`,
    });
  }

  // The tool surface belongs to the host rather than to the card — SharedOS is
  // clear that a card carries authority and nothing a product would want beside
  // it. It is served only on a self-read, because it is derived from the
  // subject's own grants and a stranger holds no authority to learn it.
  const catalogue =
    directory.relation === "self"
      ? await toolCatalogue(buildContext({ buyerId: subjectId, purpose: PURPOSES.broker }))
      : undefined;

  return json({
    served: true,
    reader: directory.reader,
    requestedView: directory.requestedView,
    relation: directory.relation,
    card: directory.read.card,
    namespaces: cardNamespaces(directory.read),
    catalogue:
      catalogue === undefined
        ? undefined
        : { hash: catalogue.hash, tools: catalogue.published.map((tool) => tool.name) },
    note:
      "Reach is derived from the grants in force at this instant and is never stored, so a revoked permission " +
      "stops appearing here the moment it is revoked. Reading this card was itself authorized.",
  });
}
