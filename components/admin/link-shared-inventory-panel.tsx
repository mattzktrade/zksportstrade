"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  linkPackageSharedInventory,
  listInventoryShareTargets,
  type InventoryShareTarget,
} from "@/app/(admin)/actions"
import { useEscapeToClose } from "@/hooks/use-escape-to-close"
import { adminPackagePath } from "@/lib/admin/package-link"
import { isSplittablePackageDuration } from "@/lib/catalog/inventory-group"
import { packageDurationLabel } from "@/lib/catalog/package-duration"
import { resolveLinkSharedInventoryRoles } from "@/lib/inventory/link-shared-inventory"

type Sibling = { id: string; name: string }

export function LinkSharedInventoryPanel({
  packageId,
  packageName,
  duration,
  ownPurchaseUnits,
  compact = false,
  alreadySharingWith = [],
}: {
  packageId: string
  packageName: string
  duration: string | null
  ownPurchaseUnits: number
  compact?: boolean
  alreadySharingWith?: Sibling[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [targets, setTargets] = useState<InventoryShareTarget[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState("")
  const [confirming, setConfirming] = useState(false)
  const canLink = isSplittablePackageDuration(duration)
  const siblings = alreadySharingWith.filter((row) => row.id !== packageId)
  const selected = useMemo(
    () => targets?.find((row) => row.id === selectedId) ?? null,
    [targets, selectedId],
  )
  const roles = selected
    ? resolveLinkSharedInventoryRoles({
        currentId: packageId,
        currentDuration: duration,
        selectedId: selected.id,
        selectedDuration: selected.duration,
      })
    : null
  const stockOwner = roles?.shareWithId === packageId
    ? { id: packageId, name: packageName }
    : selected
      ? { id: selected.id, name: selected.name }
      : null
  const joiningProduct = roles?.joiningId === packageId
    ? { id: packageId, name: packageName }
    : selected
      ? { id: selected.id, name: selected.name }
      : null

  useEffect(() => {
    if (!canLink || siblings.length > 0) return
    let cancelled = false
    void listInventoryShareTargets(packageId).then((res) => {
      if (cancelled) return
      if (!res.ok) {
        setLoadError(res.message)
        setTargets([])
        return
      }
      setLoadError(null)
      setTargets(res.targets)
    })
    return () => {
      cancelled = true
    }
  }, [canLink, packageId, siblings.length])

  useEscapeToClose(confirming, () => {
    if (!pending) setConfirming(false)
  })

  if (siblings.length > 0) {
    return (
      <div className={compact ? "text-[12px] text-muted-foreground" : "sm:col-span-2 text-sm text-muted-foreground"}>
        <p className="font-medium text-foreground">Shares stock with</p>
        <ul className="mt-1 space-y-1">
          {siblings.map((row) => (
            <li key={row.id}>
              <Link href={adminPackagePath(row.id)} className="text-primary hover:underline">
                {row.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (!canLink) {
    return (
      <p className={compact ? "text-[12px] text-muted-foreground" : "sm:col-span-2 text-xs text-muted-foreground"}>
        Set a day or weekend duration, then you can link this product so it uses another product&apos;s
        purchased stock.
      </p>
    )
  }

  function confirm() {
    if (!selected || pending) return
    start(async () => {
      const res = await linkPackageSharedInventory({
        packageId,
        shareWithPackageId: selected.id,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(res.message ?? "Stock is now shared.")
      setConfirming(false)
      router.refresh()
    })
  }

  return (
    <div className={compact ? "space-y-2" : "sm:col-span-2 space-y-2"}>
      <p className={compact ? "text-[11px] text-muted-foreground leading-relaxed" : "text-xs text-muted-foreground leading-relaxed"}>
        Link this product to another day or weekend product at the same event. Sales on this
        product then use that product&apos;s purchased stock. Any stock recorded on this product is
        removed so it is not counted twice. Confirmed deals stay.
      </p>
      {loadError ? <p className="text-xs text-destructive">{loadError}</p> : null}
      {targets && targets.length === 0 && !loadError ? (
        <p className="text-xs text-muted-foreground">
          No other day or weekend products at this event to share with. Create the weekend product
          first, then link this one.
        </p>
      ) : null}
      {targets && targets.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block min-w-0 flex-1 text-xs text-muted-foreground">
            Share stock with
            <select
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              disabled={pending}
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground"
            >
              <option value="">Select a product…</option>
              {targets.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                  {packageDurationLabel(row.duration) ? ` · ${packageDurationLabel(row.duration)}` : ""}
                  {` · ${row.qty_available} remaining`}
                  {row.bought > 0 ? ` · ${row.bought} bought` : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pending || !selectedId}
            onClick={() => setConfirming(true)}
            className="px-3 py-2 rounded-lg border border-primary/40 text-primary bg-background text-sm font-medium hover:bg-primary/5 disabled:opacity-50"
          >
            Link stock
          </button>
        </div>
      ) : null}

      {confirming && selected ? (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 p-4 sm:p-6 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="mt-16 w-full max-w-lg rounded-xl border border-border bg-card shadow-lg p-5 sm:p-6 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-foreground">Share stock with {selected.name}?</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                <strong className="font-medium text-foreground">{joiningProduct?.name}</strong> will use
                purchased stock from{" "}
                <strong className="font-medium text-foreground">{stockOwner?.name}</strong>.
                {ownPurchaseUnits > 0 && joiningProduct?.id === packageId
                  ? ` The ${ownPurchaseUnits} unit${ownPurchaseUnits === 1 ? "" : "s"} currently purchased on ${joiningProduct.name} will be removed so they are not counted twice.`
                  : joiningProduct?.id !== packageId
                    ? " Any stock recorded only on the day product will be removed so it is not counted twice."
                    : " This product has no purchase rows of its own."}{" "}
                Confirmed deals stay on {joiningProduct?.name} and will be covered from the shared stock.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirming(false)}
                className="px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={confirm}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              >
                {pending ? "Linking…" : "Link and share stock"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
