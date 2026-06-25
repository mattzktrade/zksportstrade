"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  createWixProductForPackage,
  deleteWixChannelListing,
  saveWixChannelListing,
  syncWixPackageNow,
} from "@/app/(admin)/actions"
import type { WixChannelListingRow } from "@/lib/admin/wix-channel-listings"

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

export function PackageWixListingPanel({
  packageId,
  initialListings,
  sellOnWix,
  compact = false,
  showLinkForm = true,
  onToggleLinkForm,
}: {
  packageId: string
  packageName?: string
  initialListings: WixChannelListingRow[]
  sellOnWix: boolean
  compact?: boolean
  showLinkForm?: boolean
  onToggleLinkForm?: () => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [listings, setListings] = useState(initialListings)
  const [productId, setProductId] = useState("")
  const [variantId, setVariantId] = useState("")

  useEffect(() => {
    setListings(initialListings)
  }, [initialListings])

  function save() {
    start(async () => {
      const res = await saveWixChannelListing({
        packageId,
        external_id: productId,
        external_variant_id: variantId.trim() || null,
        page_url: null,
        inventory_item_id: null,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(res.message ?? "Wix product linked.")
      if (res.listing) {
        setListings((prev) => {
          const rest = prev.filter((r) => r.id !== res.listing!.id)
          return [...rest, res.listing!]
        })
      }
      setProductId("")
      setVariantId("")
      onToggleLinkForm?.()
      router.refresh()
    })
  }

  function remove(listingId: string) {
    start(async () => {
      const res = await deleteWixChannelListing(listingId)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Wix mapping removed.")
      router.refresh()
    })
  }

  function createOnWix() {
    start(async () => {
      const res = await createWixProductForPackage(packageId)
      if (!res.ok) {
        toast.error(res.message, { duration: 12000 })
        return
      }
      toast.success(res.message ?? "Wix product created.")
      if (res.listing) setListings([res.listing])
      router.refresh()
    })
  }

  function syncNow() {
    start(async () => {
      const res = await syncWixPackageNow(packageId)
      if (!res.ok) {
        toast.error(res.message, { duration: 12000 })
        return
      }
      toast.success(res.message ?? "Wix sync completed.")
      router.refresh()
    })
  }

  if (!sellOnWix) {
    return (
      <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border px-3 py-2">
        Tick <strong>Wix website</strong> above to list on Wix Stores.
      </p>
    )
  }

  const listing = listings[0]

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Wix</p>

      {listing ? (
        <div className="text-xs space-y-1">
          <p className="font-mono break-all text-[11px]">{listing.external_id}</p>
          {listing.last_synced_at ? (
            <p className="text-muted-foreground">Synced {formatSyncDate(listing.last_synced_at)}</p>
          ) : null}
          {listing.last_sync_error ? (
            <p className="text-destructive whitespace-pre-wrap">{listing.last_sync_error}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No Wix product linked yet.</p>
      )}

      {showLinkForm && listings.length === 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-xs text-muted-foreground sm:col-span-2">
            Wix Product ID
            <input
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              placeholder="Paste from Wix Stores"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
            />
          </label>
          <label className="block text-xs text-muted-foreground sm:col-span-2">
            Wix Variant ID
            <input
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              placeholder="Required for price + stock"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
            />
          </label>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {listings.length === 0 ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => createOnWix()}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
          >
            Create on Wix
          </button>
        ) : null}
        {listings.length === 0 && onToggleLinkForm ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onToggleLinkForm()}
            className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {showLinkForm ? "Hide link form" : "Link existing"}
          </button>
        ) : null}
        {showLinkForm && listings.length === 0 && productId.trim() ? (
          <button
            type="button"
            disabled={pending || !productId.trim()}
            onClick={() => save()}
            className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            Save link
          </button>
        ) : null}
        {listing ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => syncNow()}
              className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              Push to Wix
            </button>
            {!compact ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(listing.id)}
                className="px-3 py-1.5 rounded-lg text-xs text-destructive hover:underline disabled:opacity-50"
              >
                Unlink
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
