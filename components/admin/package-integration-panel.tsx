"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { retryPackageIntegrationSync, updatePackageIntegration } from "@/app/(admin)/actions"
import type { AdminPackageRow } from "@/lib/admin/queries"
import { retailPriceFromTrade } from "@/lib/integrations/retail-price"
import { packageSyncStatusClass, packageSyncStatusLabel } from "@/lib/integrations/sync-status"
import type { WixChannelListingRow } from "@/lib/admin/wix-channel-listings"
import { PackageWixListingPanel } from "@/components/admin/package-wix-listing-panel"
import { cn } from "@/lib/utils"

export function PackageIntegrationPanel({
  initial,
  wixListings = [],
  compact = false,
}: {
  initial: AdminPackageRow
  wixListings?: WixChannelListingRow[]
  /** Shorter layout for inventory table expand rows. */
  compact?: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [showLinkWix, setShowLinkWix] = useState(false)

  const [salesforceProductId, setSalesforceProductId] = useState(initial.salesforce_product_id ?? "")
  const [retailMultiplier, setRetailMultiplier] = useState(
    initial.retail_price_multiplier != null ? String(initial.retail_price_multiplier) : "",
  )
  const [sellTrade, setSellTrade] = useState(initial.sell_on_trade_portal !== false)
  const [sellWix, setSellWix] = useState(initial.sell_on_wix === true)

  useEffect(() => {
    setSalesforceProductId(initial.salesforce_product_id ?? "")
    setRetailMultiplier(initial.retail_price_multiplier != null ? String(initial.retail_price_multiplier) : "")
    setSellTrade(initial.sell_on_trade_portal !== false)
    setSellWix(initial.sell_on_wix === true)
  }, [initial])

  const tradePrice = initial.trade_price != null ? Number(initial.trade_price) : null
  const overrideMult = retailMultiplier.trim() === "" ? null : Number(retailMultiplier)
  const websitePrice =
    tradePrice != null ? retailPriceFromTrade(tradePrice, overrideMult ?? undefined) : null

  function save() {
    start(async () => {
      let mult: number | null = null
      if (retailMultiplier.trim() !== "") {
        const n = Number(retailMultiplier)
        if (!Number.isFinite(n) || n <= 0) {
          toast.error("Website multiplier must be a positive number (e.g. 1.1).")
          return
        }
        mult = n
      }

      const res = await updatePackageIntegration({
        packageId: initial.id,
        product_code: initial.product_code?.trim() || null,
        salesforce_product_id: salesforceProductId.trim() || null,
        retail_price_multiplier: mult,
        sell_on_trade_portal: sellTrade,
        sell_on_wix: sellWix,
        sell_on_partners: false,
        enqueue_sync: true,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Integration settings saved.")
      router.refresh()
    })
  }

  function retrySync() {
    start(async () => {
      const res = await retryPackageIntegrationSync(initial.id)
      if (!res.ok) {
        toast.error(res.message, { duration: 12000 })
        return
      }
      toast.success(res.message ?? "Sync queued.", { duration: 8000 })
      router.refresh()
    })
  }

  const syncStatus = initial.integration_sync_status ?? "idle"

  return (
    <div className={cn("space-y-4", compact ? "" : "rounded-xl border border-border bg-muted/20 p-4")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Integrations</p>
          {!compact ? (
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              Salesforce syncs automatically when you save. Product code is assigned on first sync — paste a Salesforce
              Product Id only when linking an existing SF product.
            </p>
          ) : null}
        </div>
        <span
          className={cn(
            "text-[11px] font-medium px-2 py-1 rounded-md border shrink-0",
            packageSyncStatusClass(syncStatus),
          )}
        >
          {packageSyncStatusLabel(syncStatus)}
        </span>
      </div>

      {initial.product_code ? (
        <p className="text-xs text-muted-foreground">
          Salesforce code: <span className="font-mono text-foreground">{initial.product_code}</span>
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-muted-foreground sm:col-span-2">
          Salesforce Product Id
          <input
            value={salesforceProductId}
            onChange={(e) => setSalesforceProductId(e.target.value)}
            placeholder="01t… — optional; leave blank for auto-create"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Wix price multiplier
          <input
            value={retailMultiplier}
            onChange={(e) => setRetailMultiplier(e.target.value)}
            placeholder="Default 1.10 (+10%)"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
          {tradePrice != null && websitePrice != null ? (
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Trade {tradePrice.toLocaleString()} → Wix ≈ {websitePrice.toLocaleString()} {initial.currency}
            </span>
          ) : null}
        </label>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={sellTrade} onChange={(e) => setSellTrade(e.target.checked)} />
          Trade portal
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={sellWix} onChange={(e) => setSellWix(e.target.checked)} />
          Wix website
        </label>
      </div>

      {initial.integration_sync_error ? (
        <p className="text-xs text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 whitespace-pre-wrap break-words">
          {initial.integration_sync_error}
        </p>
      ) : null}

      {initial.integration_synced_at ? (
        <p className="text-[11px] text-muted-foreground">
          Last Salesforce sync: {new Date(initial.integration_synced_at).toLocaleString()}
        </p>
      ) : null}

      <PackageWixListingPanel
        packageId={initial.id}
        packageName={initial.name}
        initialListings={wixListings}
        sellOnWix={sellWix}
        compact={compact}
        showLinkForm={showLinkWix}
        onToggleLinkForm={() => setShowLinkWix((v) => !v)}
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => save()}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          Save integrations
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => retrySync()}
          className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          Queue sync
        </button>
      </div>
    </div>
  )
}
