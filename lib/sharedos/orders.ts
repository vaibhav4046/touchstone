import type { AssayInput } from "../assay/types";
import { slug } from "./identity";

/**
 * Material under examination, held only for as long as the order runs.
 *
 * The buyer supplies the vendor's listing on the call. Touchstone does not
 * accumulate a corpus of other people's sales copy: an order is a lease, and
 * when it lapses the material goes with it.
 */
export interface Order {
  readonly orderId: string;
  readonly buyerId: string;
  readonly purpose: string;
  readonly vendors: ReadonlyMap<string, AssayInput>;
  readonly createdAt: number;
}

const TTL_MS = 15 * 60_000;

/**
 * Pinned to the process, not to the module.
 *
 * The kernel is a process-global built once, so the tool handlers registered on
 * it keep whichever copy of this module existed when it was built. A bundler
 * that evaluates this file a second time — Next does, across route boundaries
 * and on every hot reload — would otherwise hand the engine a second, empty
 * registry, and every tool would report `order_closed` on material that was
 * plainly there. One map, addressed by the process.
 */
declare global {
  // eslint-disable-next-line no-var
  var __touchstoneOrders: Map<string, Order> | undefined;
}

const orders: Map<string, Order> = (globalThis.__touchstoneOrders ??= new Map<string, Order>());

export function openOrder(input: {
  readonly orderId: string;
  readonly buyerId: string;
  readonly purpose: string;
  readonly vendors: readonly AssayInput[];
}): Order {
  sweep();
  const vendors = new Map(input.vendors.map((vendor) => [slug(vendor.vendor), vendor]));
  const order: Order = { ...input, vendors, createdAt: Date.now() };
  orders.set(input.orderId, order);
  return order;
}

export function getOrder(orderId: string): Order | undefined {
  sweep();
  return orders.get(orderId);
}

export function closeOrder(orderId: string): void {
  orders.delete(orderId);
}

function sweep(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, order] of orders) {
    if (order.createdAt < cutoff) orders.delete(id);
  }
}
