import type { Address } from "@aicoo/sharedos";

export type SubagentRole =
  | "ProductLister"
  | "PriceNegotiator"
  | "PaymentManager"
  | "MarketplaceAuditor";

export interface SubagentConfig {
  readonly role: SubagentRole;
  readonly name: string;
  readonly description: string;
  readonly allowedCapabilities: readonly string[];
  readonly maxTurns: number;
}

export interface AgentMessage<T = unknown> {
  readonly id: string;
  readonly sender: Address;
  readonly recipient: Address;
  readonly grantToken: string;
  readonly action: string;
  readonly payload: T;
  readonly timestamp: string;
  readonly signature?: string;
}

export interface SubagentTurnResult<T = unknown> {
  readonly status: "completed" | "denied" | "error";
  readonly role: SubagentRole;
  readonly action: string;
  readonly output?: T;
  readonly reason?: string;
  readonly turnsUsed: number;
  readonly maxTurns: number;
  readonly auditReceipt?: {
    readonly id: string;
    readonly timestamp: string;
    readonly hash: string;
  };
}

export interface MemoryFact {
  readonly key: string;
  readonly value: string;
  readonly learnedAt: string;
  readonly source: string;
}

export interface MemoryLogEntry {
  readonly timestamp: string;
  readonly level: "info" | "warn" | "error" | "audit";
  readonly message: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AgentMemoryState {
  readonly agentRole: SubagentRole;
  readonly facts: Record<string, MemoryFact>;
  readonly logs: readonly MemoryLogEntry[];
  readonly scratchpad: Record<string, unknown>;
}
