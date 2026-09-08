import type { AuditEvent, AuditSink } from "@aicoo/sharedos";

const RING_CAPACITY = 500;
const CLOUD_ENDPOINT = "https://www.sharedos.ai/v1/audit/events";
const FLUSH_INTERVAL_MS = 2_000;
const MAX_BATCH = 40;

/** Newest-first view of what the kernel decided, for the console and the SSE feed. */
export class MemoryAuditSink implements AuditSink {
  #ring: AuditEvent[] = [];
  #listeners = new Set<(event: AuditEvent) => void>();

  async record(event: AuditEvent): Promise<void> {
    this.#ring.push(event);
    if (this.#ring.length > RING_CAPACITY) this.#ring.shift();
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // A broken console subscriber must never break an authorization path.
      }
    }
  }

  recent(limit = 100): readonly AuditEvent[] {
    return this.#ring.slice(-limit).reverse();
  }

  subscribe(listener: (event: AuditEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/**
 * Ships decisions to SharedOS Cloud.
 *
 * This is the one port no decision waits on. It batches, it swallows its own
 * failures, and a turn is never slower or less correct because shipping was.
 */
export class CloudAuditSink implements AuditSink {
  #queue: AuditEvent[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  readonly #key: string | undefined;

  constructor(key = process.env.SHAREDOS_KEY) {
    this.#key = key;
  }

  async record(event: AuditEvent): Promise<void> {
    if (this.#key === undefined || this.#key.length === 0) return;
    this.#queue.push(event);
    if (this.#queue.length >= MAX_BATCH) {
      void this.#flush();
      return;
    }
    this.#timer ??= setTimeout(() => void this.#flush(), FLUSH_INTERVAL_MS);
  }

  async #flush(): Promise<void> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    const batch = this.#queue.splice(0, MAX_BATCH);
    if (batch.length === 0) return;
    try {
      await fetch(CLOUD_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.#key}` },
        body: JSON.stringify({ events: batch }),
        signal: AbortSignal.timeout(4_000),
      });
    } catch {
      // Deliberately silent. Losing a shipped copy is survivable; stalling a
      // turn on the audit transport is not.
    }
  }
}
