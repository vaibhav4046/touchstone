import type { ResourceOperation, ResourceProvider, ResourceResult } from "@aicoo/sharedos";
import { ASSAY_NAMESPACE } from "./identity";
import { getOrder } from "./orders";

/**
 * The assay resource plane.
 *
 * Paths are the unit of authority, so they are the unit of storage too:
 *
 *   assay/vendors/<slug>/claims      the listing under examination
 *   assay/vendors/<slug>/transcript  a trial the buyer already ran
 *   assay/vendors/<slug>/probe       reaching the vendor's live endpoint
 *   assay/receipts/<orderId>         the signed finding
 *
 * The provider never widens what it was asked for. It resolves beneath the
 * order it was given and refuses anything else, including a path that merely
 * looks like it belongs to another order.
 */
export function createAssayProvider(): ResourceProvider {
  return {
    namespace: ASSAY_NAMESPACE,
    async invoke(operation: ResourceOperation): Promise<ResourceResult> {
      const completedAt = new Date().toISOString();
      const [root, first, leaf] = operation.resource.path;
      const orderId = operation.metadata?.orderId;

      if (typeof orderId !== "string") {
        return denied(operation, completedAt, "missing_order_binding", "Resource access outside an open order.");
      }
      const order = getOrder(orderId);
      if (order === undefined) {
        return denied(operation, completedAt, "order_closed", "The order that authorised this read is closed or expired.");
      }

      if (root !== "vendors" || typeof first !== "string") {
        return denied(operation, completedAt, "unknown_resource", `No provider for path ${operation.resource.path.join("/")}.`);
      }

      const vendor = order.vendors.get(first);
      if (vendor === undefined) {
        return denied(operation, completedAt, "vendor_not_in_order", `Vendor "${first}" is not part of this order.`);
      }

      switch (leaf) {
        case "claims":
          return succeeded(operation, completedAt, {
            vendor: vendor.vendor,
            pitch: vendor.pitch,
            askingPrice: vendor.askingPrice ?? null,
            bytes: vendor.pitch.length,
          });
        case "transcript":
          return succeeded(operation, completedAt, {
            vendor: vendor.vendor,
            transcript: vendor.transcript ?? null,
            present: vendor.transcript !== undefined,
          });
        default:
          return denied(operation, completedAt, "unknown_resource", `No provider for leaf "${String(leaf)}".`);
      }
    },
  };
}

function succeeded(operation: ResourceOperation, completedAt: string, output: unknown): ResourceResult {
  return { operationId: operation.operationId, completedAt, status: "succeeded", output: output as never };
}

function denied(operation: ResourceOperation, completedAt: string, code: string, message: string): ResourceResult {
  return {
    operationId: operation.operationId,
    completedAt,
    status: "denied",
    error: { code, message, retryable: false },
  };
}
