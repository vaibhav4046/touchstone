import type { AgentMemoryState, MemoryFact, MemoryLogEntry, SubagentRole } from "./types";

/**
 * Isolated memory store per subagent.
 *
 * Prevents memory bleed between distinct roles in the marketplace.
 * The ProductLister cannot see the PriceNegotiator's bargaining margin,
 * and the PriceNegotiator cannot manipulate the PaymentManager's ledger records.
 */
export class AgentMemory {
  private readonly facts = new Map<string, MemoryFact>();
  private readonly logs: MemoryLogEntry[] = [];
  private readonly scratchpad = new Map<string, unknown>();

  constructor(public readonly role: SubagentRole) {}

  setFact(key: string, value: string, source: string): void {
    this.facts.set(key, {
      key,
      value,
      learnedAt: new Date().toISOString(),
      source,
    });
  }

  getFact(key: string): string | undefined {
    return this.facts.get(key)?.value;
  }

  allFacts(): readonly MemoryFact[] {
    return Array.from(this.facts.values());
  }

  log(level: "info" | "warn" | "error" | "audit", message: string, metadata?: Record<string, unknown>): void {
    this.logs.push({
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata,
    });
    if (this.logs.length > 500) {
      this.logs.splice(0, this.logs.length - 500);
    }
  }

  getRecentLogs(limit = 20): readonly MemoryLogEntry[] {
    return this.logs.slice(-limit);
  }

  setScratch(key: string, val: unknown): void {
    this.scratchpad.set(key, val);
  }

  getScratch<T>(key: string): T | undefined {
    return this.scratchpad.get(key) as T | undefined;
  }

  snapshot(): AgentMemoryState {
    const factsObj: Record<string, MemoryFact> = {};
    for (const [k, v] of this.facts.entries()) {
      factsObj[k] = v;
    }
    const scratchObj: Record<string, unknown> = {};
    for (const [k, v] of this.scratchpad.entries()) {
      scratchObj[k] = v;
    }
    return {
      agentRole: this.role,
      facts: factsObj,
      logs: [...this.logs],
      scratchpad: scratchObj,
    };
  }

  clear(): void {
    this.facts.clear();
    this.logs.length = 0;
    this.scratchpad.clear();
  }
}
