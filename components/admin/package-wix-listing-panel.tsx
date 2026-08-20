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
    hour12: false,
  }).format(new Date(value))
}

export function PackageWixListingPanel({
  packageId,
  initialListings,
  sellOnWix,
  compact = false,
}: {
  packageId: string
  packageName?: string
  initialListings: WixChannelListingRow[]
  sellOnWix: boolean
  compact?: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [listings, setListings] = useState(initialListings)
  const [productId, setProductId] = useState("")

  useEffect(() => {
    setListings(initialListings)
  }, [initialListings])

  function linkExisting() {
    if (!productId.trim()) {
      toast.error("Paste the Wix product ID first.")
      return
    }
    start(async () => {
      const res = await saveWixChannelListing({
        packageId,
        external_id: productId.trim(),
        external_variant_id: null,
        page_url: null,
        inventory_item_id: null,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Linked to the existing website product.")
      if (res.listing) setListings([res.listing])
      setProductId("")
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
      toast.success("Website product created.")
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
      toast.success("Website listing updated.")
      router.refresh()
    })
  }

  function unlink(listingId: string) {
    start(async () => {
      const res = await deleteWixChannelListing(listingId)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Website product unlinked.")
      setListings([])
      router.refresh()
    })
  }

  if (!sellOnWix) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        Tick <strong>Website</strong> to list this product on the public site. Save visibility to create or link it.
      </p>
    )
  }

  const listing = listings[0]

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Website product</p>

      {listing ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Linked to Wix product{" "}
            <span className="font-mono text-[11px] text-foreground">{listing.external_id}</span>
          </p>
          {listing.last_synced_at ? (
            <p className="text-[11px] text-muted-foreground">Last updated {formatSyncDate(listing.last_synced_at)}</p>
          ) : null}
          {listing.last_sync_error ? (
            <p className="whitespace-pre-wrap text-xs text-destructive">{listing.last_sync_error}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => syncNow()}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              Update website
            </button>
            {!compact ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => unlink(listing.id)}
                className="rounded-lg px-3 py-1.5 text-xs text-destructive hover:underline disabled:opacity-50"
              >
                Unlink
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            This product is not on the website yet. Create a new one, or paste the ID of an existing Wix product.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => createOnWix()}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            Create website product
          </button>
          <label className="block text-xs text-muted-foreground">
            Or link an existing Wix product
            <div className="mt-1 flex flex-wrap gap-2">
              <input
                value={productId}
                onChange={(event) => setProductId(event.target.value)}
                placeholder="Paste Wix product ID"
                className="min-w-[220px] flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
              />
              <button
                type="button"
                disabled={pending || !productId.trim()}
                onClick={() => linkExisting()}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                Link existing
              </button>
            </div>
          </label>
        </div>
      )}
    </div>
  )
}
