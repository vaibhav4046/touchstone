"use client";

import { useEffect, useState } from "react";

/**
 * One audit event, as the kernel actually files it.
 *
 * Deliberately loose. This is somebody else's wire format and it will gain
 * fields; a strict shape here would turn an added key into a blank panel.
 */
interface AuditEvent {
  readonly id?: string;
  readonly at?: string;
  readonly traceId?: string;
  readonly type?: string;
  readonly outcome?: string;
  readonly purpose?: string;
  readonly action?: string;
  readonly resource?: unknown;
  readonly reasonCode?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Anything, as something React can render.
 *
 * `resource` arrives as a `ResourceRef` object, not a string, and putting one
 * straight into JSX takes the whole page down with "objects are not valid as a
 * React child". One coercion at the boundary rather than a guard at each of the
 * six places a field is printed: the fields that are strings today are not
 * promised to stay strings, and a dashboard is not worth a white screen.
 */
function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(text).join("/");
  const record = value as Record<string, unknown>;
  if (typeof record.namespace === "string" && Array.isArray(record.path)) {
    return `${record.namespace}/${record.path.map(text).join("/")}`;
  }
  if (typeof record.agentId === "string") return `agent:${record.agentId}`;
  if (typeof record.serviceId === "string") return `service:${record.serviceId}`;
  return JSON.stringify(value);
}

function reason(event: AuditEvent): string {
  return text(event.reasonCode ?? event.metadata?.reasonCode ?? event.metadata?.rule ?? "");
}

/**
 * The kernel's audit stream, live.
 *
 * The same endpoint the assay console reads. Nothing here interprets a decision:
 * an outcome is printed as the kernel filed it, including the ones that make us
 * look bad, because a ledger you can only see the wins in is a marketing page in
 * a monospace font.
 */
export default function Stream() {
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [state, setState] = useState<"connecting" | "live" | "lost">("connecting");

  useEffect(() => {
    const source = new EventSource("/api/feed");

    source.addEventListener("open", () => setState("live"));
    source.addEventListener("decision", (event) => {
      try {
        const decision = JSON.parse((event as MessageEvent<string>).data) as AuditEvent;
        setRows((current) =>
          [decision, ...current.filter((row) => row.id === undefined || row.id !== decision.id)].slice(0, 60),
        );
        setState("live");
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    });
    source.addEventListener("error", () => setState("lost"));

    return () => source.close();
  }, []);

  return (
    <>
      <p className="small muted stream-state">
        <span className={`dot ${state === "live" ? "dot-yes" : state === "lost" ? "dot-no" : ""}`} />
        {state === "live"
          ? `Connected to the kernel. ${rows.length} decision${rows.length === 1 ? "" : "s"} on this instance.`
          : state === "lost"
            ? "Stream dropped. Serverless recycles instances, so reload to reattach."
            : "Connecting."}
      </p>
      {rows.length === 0 ? (
        <p className="empty">
          Nothing decided on this instance yet. Run a deal on the home page and the rows arrive here as the calls are
          authorised, not afterwards.
        </p>
      ) : (
        <ol className="stream">
          {rows.map((row, index) => (
            <li key={row.id ?? `${row.traceId ?? "t"}-${index}`} data-outcome={text(row.outcome)}>
              <code className="verb">{text(row.type ?? row.action) || "event"}</code>
              <code className="res">{text(row.resource) || text(row.purpose)}</code>
              {reason(row) !== "" && <span className="muted small">{reason(row)}</span>}
              <span className="outcome">{text(row.outcome)}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
