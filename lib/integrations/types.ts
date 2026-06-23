export const INTEGRATION_EVENT_TYPES = [
  "product.upsert",
  "inventory.snapshot",
  "order.placed",
  "invoice.create",
  "order.outcome",
] as const

export type IntegrationEventType = (typeof INTEGRATION_EVENT_TYPES)[number]

export const PACKAGE_SYNC_STATUSES = ["idle", "pending", "synced", "failed"] as const
export type PackageSyncStatus = (typeof PACKAGE_SYNC_STATUSES)[number]

export const ORDER_CHANNELS = ["trade_portal", "wix", "partner_api", "admin"] as const
export type OrderChannel = (typeof ORDER_CHANNELS)[number]

export const SALESFORCE_ORDER_SYNC_STATUSES = ["pending", "synced", "failed", "skipped"] as const
export type SalesforceOrderSyncStatus = (typeof SALESFORCE_ORDER_SYNC_STATUSES)[number]

export type ProductUpsertPayload = {
  package_id: string
  triggered_at: string
}
