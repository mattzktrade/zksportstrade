"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createWixProductForPackage, updatePackageIntegration } from "@/app/(admin)/actions"
import type { AdminPackageRow } from "@/lib/admin/queries"
import { retailPriceFromTrade } from "@/lib/integrations/retail-price"
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
  compact?: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [retailMultiplier, setRetailMultiplier] = useState(
    initial.retail_price_multiplier != null ? String(initial.retail_price_multiplier) : "",
  )
  const [wixRetailPrice, setWixRetailPrice] = useState(
    initial.wix_retail_price != null ? String(initial.wix_retail_price) : "",
  )
  const [sellTrade, setSellTrade] = useState(initial.sell_on_trade_portal !== false)
  const [sellWix, setSellWix] = useState(initial.sell_on_wix === true)
  const [hidden, setHidden] = useState(initial.is_hidden === true)

  useEffect(() => {
    setRetailMultiplier(initial.retail_price_multiplier != null ? String(initial.retail_price_multiplier) : "")
    setWixRetailPrice(initial.wix_retail_price != null ? String(initial.wix_retail_price) : "")
    setSellTrade(initial.sell_on_trade_portal !== false)
    setSellWix(initial.sell_on_wix === true)
    setHidden(initial.is_hidden === true)
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
          toast.error("Website price must be zero or a positive number.")
          return
        }
        manualPrice = n
      }

      const liveOnWebsite = !hidden && sellWix
      const res = await updatePackageIntegration({
        packageId: initial.id,
        product_code: initial.product_code ?? null,
        salesforce_product_id: initial.salesforce_product_id ?? null,
        retail_price_multiplier: mult,
        wix_retail_price: manualPrice,
        sell_on_trade_portal: !hidden && sellTrade,
        sell_on_wix: liveOnWebsite,
        sell_on_partners: false,
        is_hidden: hidden,
        enqueue_sync: true,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }

      if (liveOnWebsite && wixListings.length === 0) {
        const created = await createWixProductForPackage(initial.id)
        if (!created.ok) {
          toast.success("Visibility saved.")
          toast.error(created.message || "Could not create the website product automatically. Link an existing one below.")
          router.refresh()
          return
        }
        toast.success("Visibility saved and a website product was created.")
        router.refresh()
        return
      }

      toast.success("Visibility saved.")
      router.refresh()
    })
  }

  return (
    <div className={cn("space-y-4", compact ? "" : "rounded-xl border border-border bg-muted/20 p-4")}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product visibility</p>
        {!compact ? (
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            Choose where this product can be sold. Turning on the website creates a Wix product if one is not linked
            yet, or you can paste an existing Wix product ID.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!hidden && sellTrade}
            onChange={(event) => {
              setSellTrade(event.target.checked)
              if (event.target.checked) setHidden(false)
            }}
          />
          Trade portal
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!hidden && sellWix}
            onChange={(event) => {
              setSellWix(event.target.checked)
              if (event.target.checked) setHidden(false)
            }}
          />
          Website
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={hidden}
            onChange={(event) => {
              setHidden(event.target.checked)
              if (event.target.checked) {
                setSellTrade(false)
                setSellWix(false)
              }
            }}
          />
          Hidden
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-muted-foreground">
          Website price multiplier
          <input
            value={retailMultiplier}
            onChange={(event) => setRetailMultiplier(event.target.value)}
            placeholder="Default 1.10 (+10%)"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          {tradePrice != null && websitePrice != null ? (
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Trade {tradePrice.toLocaleString()} → website {manualWixPrice != null ? "=" : "≈"}{" "}
              {websitePrice.toLocaleString()} {initial.currency}
            </span>
          ) : null}
        </label>
        <label className="block text-xs text-muted-foreground">
          Manual website price
          <input
            value={wixRetailPrice}
            onChange={(event) => setWixRetailPrice(event.target.value)}
            placeholder="Leave blank to use the multiplier"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-[11px] text-muted-foreground">
            Optional. Use this when the website price should not follow the multiplier.
          </span>
        </label>
      </div>

      <PackageWixListingPanel
        packageId={initial.id}
        packageName={initial.name}
        initialListings={wixListings}
        sellOnWix={!hidden && sellWix}
        compact={compact}
      />

      <button
        type="button"
        disabled={pending}
        onClick={() => save()}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        Save visibility
      </button>
    </div>
  )
}
