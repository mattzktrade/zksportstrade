"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { clearPackageSalesforceLink, retryPackageIntegrationSync, updatePackageIntegration } from "@/app/(admin)/actions"
import type { AdminPackageRow } from "@/lib/admin/queries"
import { retailPriceFromTrade } from "@/lib/integrations/retail-price"
import { packageSyncStatusClass, packageSyncStatusLabel } from "@/lib/integrations/sync-status"
import type { WixChannelListingRow } from "@/lib/admin/wix-channel-listings"
import { PackageWixListingPanel } from "@/components/admin/package-wix-listing-panel"
import { cn } from "@/lib/utils"

function formatSyncDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value))
}

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
  const [wixRetailPrice, setWixRetailPrice] = useState(
    initial.wix_retail_price != null ? String(initial.wix_retail_price) : "",
  )
  const [sellTrade, setSellTrade] = useState(initial.sell_on_trade_portal !== false)
  const [sellWix, setSellWix] = useState(initial.sell_on_wix === true)

  useEffect(() => {
    setSalesforceProductId(initial.salesforce_product_id ?? "")
    setRetailMultiplier(initial.retail_price_multiplier != null ? String(initial.retail_price_multiplier) : "")
    setWixRetailPrice(initial.wix_retail_price != null ? String(initial.wix_retail_price) : "")
    setSellTrade(initial.sell_on_trade_portal !== false)
    setSellWix(initial.sell_on_wix === true)
  }, [initial])

  const tradePrice = initial.trade_price != null ? Number(initial.trade_price) : null
  const overrideMult = retailMultiplier.trim() === "" ? null : Number(retailMultiplier)
  const manualWixPrice = wixRetailPrice.trim() === "" ? null : Number(wixRetailPrice)
  const websitePrice =
    tradePrice != null ? retailPriceFromTrade(tradePrice, overrideMult ?? undefined, manualWixPrice) : manualWixPrice

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
      let manualPrice: number | null = null
      if (wixRetailPrice.trim() !== "") {
        const n = Number(wixRetailPrice)
        if (!Number.isFinite(n) || n < 0) {
          toast.error("Manual Wix price must be zero or a positive number.")
          return
        }
        manualPrice = n
      }

      const res = await updatePackageIntegration({
        packageId: initial.id,
        product_code: initial.product_code?.trim() || null,
        salesforce_product_id: salesforceProductId.trim() || null,
        retail_price_multiplier: mult,
        wix_retail_price: manualPrice,
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

  function clearSalesforceLink() {
    if (
      !window.confirm(
        "Clear the saved Salesforce Product Id and Product Code for this package? Use this when the current values came from sandbox or the wrong org.",
      )
    ) {
      return
    }
    start(async () => {
      const res = await clearPackageSalesforceLink(initial.id)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Salesforce link cleared. Queue Salesforce sync to create/link the live product.")
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
          {initial.salesforce_product_id || initial.product_code ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => clearSalesforceLink()}
              className="mt-1 text-[11px] font-medium text-destructive hover:underline disabled:opacity-50"
            >
              Clear Salesforce link/code
            </button>
          ) : null}
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
              Trade {tradePrice.toLocaleString()} → Wix {manualWixPrice != null ? "=" : "≈"}{" "}
              {websitePrice.toLocaleString()} {initial.currency}
            </span>
          ) : null}
        </label>
        <label className="block text-xs text-muted-foreground">
          Manual Wix price
          <input
            value={wixRetailPrice}
            onChange={(e) => setWixRetailPrice(e.target.value)}
            placeholder="Leave blank to use multiplier"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
          <span className="mt-1 block text-[11px] text-muted-foreground">
            Overrides the multiplier when set. Use this for hand-picked Wix prices.
          </span>
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
          Last Salesforce sync: {formatSyncDate(initial.integration_synced_at)}
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
          Queue Salesforce sync
        </button>
      </div>
    </div>
  )
}
