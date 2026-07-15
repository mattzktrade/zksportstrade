"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { createPackage } from "@/app/(admin)/actions"
import type { LinkedDayPackageOverview, LinkedDayPackagePreset } from "@/lib/admin/linked-day-package-overview"
import type { ShellDayDuration } from "@/lib/catalog/shell-single-tickets"

const DAY_LABEL: Record<ShellDayDuration, string> = {
  thursday_only: "Thursday",
  friday_only: "Friday",
  saturday_only: "Saturday",
  sunday_only: "Sunday",
}

const SF_PRODUCT2_ID_RE = /^[a-zA-Z0-9]{15,18}$/

/** Derive a sensible sellable-day package name from the 3-day parent's name. */
function suggestDayPackageName(parentName: string, duration: ShellDayDuration): string {
  const day = DAY_LABEL[duration]
  const base = parentName.replace(/^\s*3\s*Days?\s+/i, "").trim()
  if (!base) return `${day} Package`
  return `${day} ${base}`
}

/** Compact linked-group controls for the Inventory tab (sync + add day package). */
export function LinkedDayInventoryToolbar({ overview }: { overview: LinkedDayPackageOverview }) {
  const { inventoryGroupId, missingDayDurations, parentPreset } = overview

  const [addOpen, setAddOpen] = useState<ShellDayDuration | null>(null)

  if (!parentPreset && !inventoryGroupId) return null

  const canOfferQuickAdd = !!parentPreset && !!inventoryGroupId && missingDayDurations.length > 0
  const missingIfNoGroup = !inventoryGroupId && !!parentPreset

  return (
    <div className="space-y-3">
      {inventoryGroupId ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="uppercase tracking-wide font-medium">Linked inventory key</span>
          <span className="font-mono rounded border border-border bg-muted/30 px-2 py-0.5">{inventoryGroupId}</span>
        </div>
      ) : null}

      {missingIfNoGroup ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-[12px] leading-relaxed">
          Set a Linked inventory key on the Details tab and save — then new day packages can share this
          product&apos;s stock.
        </div>
      ) : null}

      {canOfferQuickAdd ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Add day package:</span>
          {missingDayDurations.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setAddOpen(d)}
              className="px-3 py-1.5 rounded-md border border-primary/40 text-primary bg-background text-xs font-medium hover:bg-primary/5"
            >
              + {DAY_LABEL[d]}-only
            </button>
          ))}
        </div>
      ) : null}

      {addOpen && parentPreset && inventoryGroupId ? (
        <QuickAddDialog
          duration={addOpen}
          preset={parentPreset}
          inventoryGroupId={inventoryGroupId}
          onClose={() => setAddOpen(null)}
        />
      ) : null}
    </div>
  )
}

/** @deprecated Use LinkedDayInventoryToolbar — table lives on Inventory & cost tab. */
export function LinkedDayPackagesPanel({ overview }: { overview: LinkedDayPackageOverview }) {
  return <LinkedDayInventoryToolbar overview={overview} />
}

function QuickAddDialog({
  duration,
  preset,
  inventoryGroupId,
  onClose,
}: {
  duration: ShellDayDuration
  preset: LinkedDayPackagePreset
  inventoryGroupId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const defaultName = useMemo(() => suggestDayPackageName(preset.parent_name, duration), [preset.parent_name, duration])
  const [name, setName] = useState(defaultName)
  const [tradePrice, setTradePrice] = useState("")
  const [isEnquiry, setIsEnquiry] = useState(false)
  const [sellOnWix, setSellOnWix] = useState(false)
  const [salesforceProductId, setSalesforceProductId] = useState("")

  function submit() {
    if (pending) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error("Enter a display name.")
      return
    }
    let price: number | null = null
    if (!isEnquiry) {
      const raw = tradePrice.trim()
      if (!raw) {
        toast.error("Enter a trade price (or tick Enquiry).")
        return
      }
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 0) {
        toast.error("Trade price must be a non-negative number.")
        return
      }
      price = n
    }

    const sfIdRaw = salesforceProductId.trim()
    const sfId = sfIdRaw.length === 0 ? null : sfIdRaw
    if (sfId && !SF_PRODUCT2_ID_RE.test(sfId)) {
      toast.error("Salesforce Product Id must be 15–18 alphanumeric characters (starts with 01t...).")
      return
    }

    start(async () => {
      const res = await createPackage({
        race_id: preset.race_id,
        name: trimmedName,
        circuit: preset.circuit,
        location: preset.location,
        country: preset.country,
        country_code: preset.country_code,
        event_date: preset.event_date,
        date_range: preset.date_range,
        description: preset.description,
        image: preset.image,
        gallery_images: preset.gallery_images,
        currency: preset.currency,
        total_capacity: preset.total_capacity,
        duration,
        inventory_group_id: inventoryGroupId,
        includes: preset.includes,
        trade_price: price,
        is_enquiry: isEnquiry,
        requires_booking_approval: preset.requires_booking_approval,
        featured: false,
        sort_order: 100,
        brochure_url: preset.brochure_url,
        sell_on_wix: sellOnWix,
        salesforce_product_id: sfId,
        // Linked inventory: stock lives on the 3-day parent and is seeded from siblings in
        // createPackage — do NOT set an initial qty here.
        initial_qty_available: 0,
        initial_unit_cost: null,
        initial_cost_note: null,
        initial_source: null,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(
        res.message ??
          (sfId
            ? `${DAY_LABEL[duration]} package created and linked to Salesforce.`
            : `${DAY_LABEL[duration]} package created — Salesforce product will be auto-created on sync.`),
      )
      onClose()
      router.refresh()
    })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 p-4 sm:p-6 overflow-y-auto">
      <div className="mt-8 w-full max-w-lg rounded-xl border border-border bg-card shadow-lg p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              New {DAY_LABEL[duration]} package
            </h3>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
              Race, dates, description, includes, image, and the Linked inventory key are copied from the
              3-day parent. Stock is shared. Salesforce gets a new product on sync (leave Product Id
              blank) — you do not need to create the package in Salesforce first.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Close
          </button>
        </div>

        <div className="space-y-3">
          <label className="block text-xs text-muted-foreground">
            Display name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-muted-foreground">
              Trade price ({preset.currency})
              <input
                inputMode="decimal"
                value={tradePrice}
                onChange={(e) => setTradePrice(e.target.value)}
                disabled={isEnquiry}
                placeholder={isEnquiry ? "Enquiry" : "e.g. 2500"}
                className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm disabled:opacity-50"
              />
            </label>
            <div className="flex flex-col justify-end gap-2 text-xs">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isEnquiry}
                  onChange={(e) => {
                    setIsEnquiry(e.target.checked)
                    if (e.target.checked) setSellOnWix(false)
                  }}
                />
                Enquiry package
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={sellOnWix}
                  onChange={(e) => setSellOnWix(e.target.checked)}
                  disabled={isEnquiry}
                />
                Sell on Wix
              </label>
            </div>
          </div>

          <label className="block text-xs text-muted-foreground">
            Salesforce Product2 Id (optional)
            <input
              value={salesforceProductId}
              onChange={(e) => setSalesforceProductId(e.target.value)}
              placeholder="Leave blank to auto-create — or paste 01t… to link an existing product"
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="mt-1 block text-[10px] text-muted-foreground/80 leading-snug">
              Leave blank for a new Sunday/Friday package — sync creates the Salesforce product and
              shares stock with this 3-day group. Only paste an Id if the product already exists in
              Salesforce and you want to link it instead of creating a duplicate.
            </span>
          </label>

          <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-[11px] text-muted-foreground space-y-1">
            <p>
              <span className="font-medium text-foreground/80">Linked inventory key:</span>{" "}
              <span className="font-mono">{inventoryGroupId}</span>
            </p>
            <p>
              <span className="font-medium text-foreground/80">Race / dates:</span> {preset.circuit || "—"} ·{" "}
              {preset.event_date || "—"}
            </p>
            <p>
              <span className="font-medium text-foreground/80">Includes:</span>{" "}
              {preset.includes.length > 0 ? `${preset.includes.length} items copied` : "none copied"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {pending ? "Creating…" : `Create ${DAY_LABEL[duration]} package`}
          </button>
        </div>
      </div>
    </div>
  )
}
