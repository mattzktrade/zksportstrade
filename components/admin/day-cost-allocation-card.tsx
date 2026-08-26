"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { saveInventoryGroupCostPolicy } from "@/app/(admin)/actions"
import type { LinkedDayPackageOverview } from "@/lib/admin/linked-day-package-overview"
import {
  allocateCostByDay,
  costDaySlotsForDuration,
  dayLabel,
  deriveTradePriceDayWeights,
  validateManualDayPercentages,
  type CostDaySlot,
} from "@/lib/inventory/day-cost-allocation"
import { formatMoney } from "@/lib/format/money"

type Props = {
  overview: LinkedDayPackageOverview
  currentPackageId: string
  currency: string
  initialPreviewCost: number | null
}

function percent(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(2)}%`
}

function initialManualPercentages(
  days: readonly CostDaySlot[],
  weights: Partial<Record<CostDaySlot, number>>,
): Partial<Record<CostDaySlot, string>> {
  let assigned = 0
  return Object.fromEntries(
    days.map((day, index) => {
      const basisPoints =
        index === days.length - 1
          ? 1_000_000 - assigned
          : Math.round((weights[day] ?? 0) * 1_000_000)
      assigned += basisPoints
      return [day, (basisPoints / 10_000).toFixed(4).replace(/\.?0+$/, "")]
    }),
  )
}

export function DayCostAllocationCard({
  overview,
  currentPackageId,
  currency,
  initialPreviewCost,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const source =
    overview.siblings.find(
      (member) =>
        member.id === currentPackageId &&
        (member.duration === "3_day" || member.duration === "2_day"),
    ) ??
    overview.siblings.find((member) => member.duration === "3_day") ??
    overview.siblings.find((member) => member.duration === "2_day") ??
    null
  const days = useMemo(
    () =>
      costDaySlotsForDuration(
        source?.duration,
        overview.raceEventDate,
      ),
    [source?.duration, overview.raceEventDate],
  )
  const derived = useMemo(
    () =>
      deriveTradePriceDayWeights({
        sourceDuration: source?.duration,
        eventDate: overview.raceEventDate,
        members: overview.siblings.map((member) => ({
          packageId: member.id,
          duration: member.duration,
          tradePrice: member.trade_price,
        })),
      }),
    [source?.duration, overview.raceEventDate, overview.siblings],
  )
  const derivedWeights = Object.fromEntries(
    derived.rows.map((row) => [row.day, row.weight ?? 0]),
  ) as Partial<Record<CostDaySlot, number>>
  const savedWeights =
    overview.costPolicy?.mode === "manual" ? overview.costPolicy.weights : derivedWeights
  const [mode, setMode] = useState<"derived" | "manual">(
    overview.costPolicy?.mode ?? "derived",
  )
  const [manual, setManual] = useState<Partial<Record<CostDaySlot, string>>>(() =>
    initialManualPercentages(days, savedWeights),
  )
  const [previewCost, setPreviewCost] = useState(
    initialPreviewCost != null && initialPreviewCost >= 0 ? String(initialPreviewCost) : "",
  )

  if (!overview.inventoryGroupId || !source || days.length < 2) return null

  const manualValidation = validateManualDayPercentages(days, manual)
  const activeWeights =
    mode === "manual" && manualValidation.ok
      ? manualValidation.weights
      : mode === "derived" && derived.status === "derived"
        ? derivedWeights
        : null
  const previewAmount = Number(previewCost)
  const preview =
    activeWeights && Number.isFinite(previewAmount) && previewAmount >= 0
      ? allocateCostByDay(
          previewAmount,
          days.map((day) => ({ day, weight: activeWeights[day] ?? 0 })),
        )
      : null
  const status =
    mode === "manual"
      ? manualValidation.ok
        ? "Manual"
        : "Setup required"
      : derived.status === "derived"
        ? "Derived"
        : "Setup required"
  const rowByDay = new Map(derived.rows.map((row) => [row.day, row]))

  function save() {
    if (mode === "manual" && !manualValidation.ok) {
      toast.error(manualValidation.message)
      return
    }
    startTransition(async () => {
      const result = await saveInventoryGroupCostPolicy({
        inventoryGroupId: overview.inventoryGroupId!,
        sourcePackageId: source!.id,
        mode,
        percentages: mode === "manual" ? manual : undefined,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  return (
    <section className="rounded-lg border border-border bg-muted/15 p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Day cost allocation
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed max-w-3xl">
            Each new {source.duration === "2_day" ? "2-day" : "3-day"} purchase is split across its
            included days. Derived percentages use relative day trade prices and normalize to 100%.
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
            status === "Setup required"
              ? "border-amber-400/60 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
              : "border-border bg-background text-foreground"
          }`}
        >
          {status}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="day-cost-policy"
            checked={mode === "derived"}
            onChange={() => setMode("derived")}
          />
          Derived from trade prices
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="day-cost-policy"
            checked={mode === "manual"}
            onChange={() => setMode("manual")}
          />
          Manual percentages
        </label>
        <label className="ml-auto flex items-center gap-2 text-muted-foreground">
          Preview buy price ({currency})
          <input
            inputMode="decimal"
            value={previewCost}
            onChange={(event) => setPreviewCost(event.target.value)}
            className="w-28 rounded border border-border bg-background px-2 py-1 text-right text-foreground"
            placeholder="e.g. 10000"
          />
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Included day</th>
              <th className="px-3 py-2 font-medium text-right">Trade price</th>
              <th className="px-3 py-2 font-medium text-right">Normalized</th>
              <th className="px-3 py-2 font-medium text-right">Cost preview</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const row = rowByDay.get(day)
              const weight = activeWeights?.[day] ?? null
              return (
                <tr key={day} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{dayLabel(day)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row?.tradePrice != null ? formatMoney(currency, row.tradePrice) : (
                      <span className="text-amber-700 dark:text-amber-200">Missing</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {mode === "manual" ? (
                      <div className="flex items-center justify-end gap-1">
                        <input
                          inputMode="decimal"
                          value={manual[day] ?? ""}
                          onChange={(event) =>
                            setManual((current) => ({ ...current, [day]: event.target.value }))
                          }
                          className="w-20 rounded border border-border bg-background px-2 py-1 text-right"
                        />
                        <span>%</span>
                      </div>
                    ) : (
                      percent(weight)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {preview ? formatMoney(currency, preview[day]) : "—"}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {mode === "derived" && derived.status === "setup_required" ? (
        <p className="text-[11px] text-amber-800 dark:text-amber-200">
          Add a positive trade price for {derived.missingDays.map(dayLabel).join(" and ")}, or select
          Manual percentages. A shared purchase cannot be added until one valid method is saved.
        </p>
      ) : mode === "manual" && !manualValidation.ok ? (
        <p className="text-[11px] text-amber-800 dark:text-amber-200">
          {manualValidation.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={
            pending ||
            (mode === "derived" && derived.status !== "derived") ||
            (mode === "manual" && !manualValidation.ok)
          }
          onClick={save}
          className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save allocation policy"}
        </button>
        <p className="text-[10px] text-muted-foreground">
          Policy changes apply only to future purchases.
        </p>
      </div>

      <div className="rounded-md border border-border bg-background/70 px-3 py-2">
        <p className="text-[11px] font-medium text-foreground">Frozen purchase snapshots</p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
          Every purchase stores its day percentages and apportioned costs permanently. Later trade
          price or policy changes do not rewrite completed-order margins.
        </p>
        {overview.frozenPurchaseSplits.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {overview.frozenPurchaseSplits.map((purchase) => (
              <div
                key={purchase.costLayerId}
                className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground"
              >
                <span className="font-medium text-foreground">
                  {purchase.receivedAt
                    ? new Date(purchase.receivedAt).toLocaleDateString("en-GB", {
                        timeZone: "UTC",
                      })
                    : "Purchase"}{" "}
                  · {formatMoney(purchase.currency, purchase.unitCost)}
                </span>
                {purchase.sourceOrigin === "ambiguous_shared_ledger" ? (
                  <span className="rounded border border-amber-400/60 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    Review historical purchased product
                  </span>
                ) : null}
                {purchase.components.map((component) => (
                  <span key={component.day}>
                    {dayLabel(component.day)} {percent(component.weight)} ·{" "}
                    {formatMoney(purchase.currency, component.unitCost)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[10px] italic text-muted-foreground">
            No frozen day splits are available yet.
          </p>
        )}
      </div>
    </section>
  )
}
