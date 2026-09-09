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
export interface ShippingState {
  /** Whether a key is configured at all. */
  readonly configured: boolean;
  /** Stopped trying: the credential was rejected three times. */
  readonly shuttered: boolean;
  /** What the last attempt actually did. `never-attempted` until one is made. */
  readonly last: "never-attempted" | "accepted" | string;
  readonly at?: string;
  readonly shipped: number;
  readonly failed: number;
}

export class CloudAuditSink implements AuditSink {
  #queue: AuditEvent[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  readonly #key: string | undefined;
  #last: string = "never-attempted";
  #at: string | undefined;
  #shipped = 0;
  #failed = 0;
  #authFailures = 0;

  constructor(key = process.env.SHAREDOS_KEY) {
    this.#key = key;
  }

  /**
   * What shipping is actually doing, rather than whether it was switched on.
   *
   * `/api/health` used to report `auditShipping: "enabled"` on the strength of
   * an environment variable existing. The variable existed in production, the
   * endpoint answered 401 `revoked project key` to every batch, the sink
   * swallowed it by design, and the service went on claiming its decisions were
   * being shipped. A status derived from configuration rather than from an
   * outcome is not a status.
   */
  state(): ShippingState {
    return {
      configured: this.#key !== undefined && this.#key.length > 0,
      shuttered: this.#shuttered(),
      last: this.#last,
      at: this.#at,
      shipped: this.#shipped,
      failed: this.#failed,
    };
  }

  /**
   * Stop asking once the answer is settled.
   *
   * A 401 or 403 is the credential being wrong, and it will still be wrong on
   * the next batch. Retrying it every few seconds spends a four-second timeout
   * per attempt against a serverless invocation budget and pushes a rejected
   * request at somebody else's service for the life of the deployment. Three
   * strikes and the sink goes quiet until the process restarts, which is also
   * when a corrected key would arrive.
   */
  #shuttered(): boolean {
    return this.#authFailures >= 3;
  }

  async record(event: AuditEvent): Promise<void> {
    if (this.#key === undefined || this.#key.length === 0) return;
    if (this.#shuttered()) return;
    this.#queue.push(event);
    if (this.#queue.length >= MAX_BATCH) {
      void this.#flush();
      return;
    }
    this.#timer ??= setTimeout(() => void this.#flush(), FLUSH_INTERVAL_MS);
  }

  /**
   * Ship whatever is queued, now.
   *
   * A timer is the right batching strategy for a process that keeps running and
   * the wrong one for a serverless function, which is frozen the moment its
   * response is written — the callback simply never fires, and the events are
   * still sitting in the queue when the instance is thawed for an unrelated
   * request or discarded entirely. Two of every three escalations went missing
   * that way before this existed. Routes call it through `after()`, which keeps
   * the invocation alive until the flush finishes without making the caller
   * wait for it.
   */
  async drain(): Promise<void> {
    while (this.#queue.length > 0) await this.#flush();
  }

  async #flush(): Promise<void> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    const batch = this.#queue.splice(0, MAX_BATCH);
    if (batch.length === 0) return;
    this.#at = new Date().toISOString();
    try {
      const response = await fetch(CLOUD_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.#key}` },
        body: JSON.stringify({ events: batch }),
        signal: AbortSignal.timeout(4_000),
      });
      // Still silent to the caller, still recorded. Losing a shipped copy is
      // survivable and stalling a turn on the audit transport is not, but
      // neither is a reason for the service to be unable to say which happened.
      if (response.ok) {
        this.#last = "accepted";
        this.#shipped += batch.length;
      } else {
        this.#last = `http_${response.status}`;
        this.#failed += batch.length;
        if (response.status === 401 || response.status === 403) {
          this.#authFailures += 1;
          if (this.#shuttered()) {
            this.#last = `http_${response.status} (shuttered after 3 rejections; a bad key stays bad)`;
            this.#queue.length = 0;
          }
        }
      }
    } catch (error) {
      this.#last = error instanceof Error ? error.name : "unknown";
      this.#failed += batch.length;
    }
  }
}
