"use client"

import { useMemo, useState } from "react"
import { Plus, X } from "lucide-react"
import type { OperationsLineOption } from "@/lib/admin/workflow-views"
import {
  buildSupplierDrafts,
  groupOrderPackages,
  groupSupplierOptions,
  layerTakesForDrafts,
  previewSupplierOptions,
  validateSupplierDrafts,
  type LayerTake,
  type OperationsStockAllocation,
  type OperationsStockLayer,
  type SupplierStockDraft,
} from "@/lib/operations/stock"

export function OperationsSupplierEditor({
  title,
  subtitle,
  orderId,
  lines,
  layers,
  allocations,
  pending,
  onClose,
  onSave,
}: {
  title: string
  subtitle: string
  orderId: string
  lines: OperationsLineOption[]
  layers: OperationsStockLayer[]
  allocations: OperationsStockAllocation[]
  pending: boolean
  onClose: () => void
  onSave: (packageId: string, takes: LayerTake[]) => void
}) {
  const products = groupOrderPackages(lines)

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4">
      <div className="flex max-h-[92dvh] w-full max-w-lg min-h-0 flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="mt-0.5 text-[9px] text-slate-400">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {products.map((product) => (
            <ProductStockEditor
              key={`${product.packageId}:${allocations
                .filter((row) => row.orderId === orderId && row.packageId === product.packageId)
                .map((row) => `${row.costLayerId}:${row.quantity}`)
                .join("|")}`}
              orderId={orderId}
              product={product}
              layers={layers}
              allocations={allocations}
              pending={pending}
              onSave={onSave}
            />
          ))}
          {products.length === 0 ? (
            <p className="text-[9px] text-slate-400">This booking has no products to allocate.</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ProductStockEditor({
  orderId,
  product,
  layers,
  allocations,
  pending,
  onSave,
}: {
  orderId: string
  product: OperationsLineOption
  layers: OperationsStockLayer[]
  allocations: OperationsStockAllocation[]
  pending: boolean
  onSave: (packageId: string, takes: LayerTake[]) => void
}) {
  const options = useMemo(
    () =>
      groupSupplierOptions(
        layers,
        allocations,
        orderId,
        product.packageId,
        product.ledgerPackageId,
        product.quantity,
      ),
    [allocations, layers, orderId, product.ledgerPackageId, product.packageId, product.quantity],
  )
  const [drafts, setDrafts] = useState<SupplierStockDraft[]>(() =>
    buildSupplierDrafts(options, product.quantity),
  )
  const liveOptions = previewSupplierOptions(options, drafts)
  const assigned = drafts.reduce((sum, row) => sum + (Math.floor(Number(row.quantity)) || 0), 0)
  const error = validateSupplierDrafts(drafts, options, product.quantity)
  const lockedAllocation = allocations.find(
    (row) => row.orderId === orderId && row.packageId === product.packageId && row.locked,
  )

  function setRow(key: string, patch: Partial<SupplierStockDraft>) {
    setDrafts((currentRows) =>
      currentRows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    )
  }

  function bump(key: string, delta: number) {
    setDrafts((currentRows) =>
      currentRows.map((row) => {
        if (row.key !== key) return row
        const current = Math.floor(Number(row.quantity))
        const next = Math.max(1, Math.min(product.quantity, (Number.isInteger(current) ? current : 0) + delta))
        return { ...row, quantity: String(next) }
      }),
    )
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-[10px] font-semibold text-slate-700">
        {product.quantity}× {product.description}
      </p>

      {lockedAllocation ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-[9px] text-amber-800">
          Allocation locked: {lockedAllocation.lockReason || "fulfilment has started"}. Reassigning now could change
          the supplier responsible for delivery.
        </div>
      ) : options.length === 0 ? (
        <p className="mt-3 text-[9px] text-amber-700">No remaining stock for this product.</p>
      ) : (
        <>
          <div className="mt-3 space-y-2">
            {drafts.map((draft) => (
                <div key={draft.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                  <select
                    value={draft.supplierKey}
                    onChange={(event) => setRow(draft.key, { supplierKey: event.target.value })}
                    className="h-9 rounded-md border bg-white px-2 text-[9px]"
                  >
                    <option value="">Select supplier</option>
                    {liveOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.supplierName} · {Math.max(0, option.remaining)} left
                        {option.using > 0 ? ` · using ${option.using}` : ""}
                      </option>
                    ))}
                  </select>
                  <div className="flex h-9 overflow-hidden rounded-md border">
                    <button
                      type="button"
                      onClick={() => bump(draft.key, -1)}
                      className="px-2 text-[12px] text-slate-500 hover:bg-slate-50"
                    >
                      −
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={draft.quantity}
                      onChange={(event) => setRow(draft.key, { quantity: event.target.value.replace(/[^\d]/g, "") })}
                      className="w-10 border-x text-center text-[9px] outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => bump(draft.key, 1)}
                      className="px-2 text-[12px] text-slate-500 hover:bg-slate-50"
                    >
                      +
                    </button>
                  </div>
                  {drafts.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setDrafts((currentRows) => currentRows.filter((row) => row.key !== draft.key))}
                      className="text-[9px] font-semibold text-slate-400 hover:underline"
                    >
                      Remove
                    </button>
                  ) : (
                    <span className="w-12" />
                  )}
                </div>
            ))}
          </div>

          {options.length > 1 ? (
            <button
              type="button"
              onClick={() =>
                setDrafts((currentRows) => [
                  ...currentRows,
                  {
                    key: `row-${Math.random().toString(36).slice(2, 8)}`,
                    supplierKey: options.find((option) => !currentRows.some((row) => row.supplierKey === option.key))?.key ?? "",
                    quantity: "1",
                  },
                ])
              }
              className="mt-2 inline-flex items-center gap-1 text-[9px] font-semibold text-primary hover:underline"
            >
              <Plus className="h-3 w-3" />
              Split across suppliers
            </button>
          ) : null}

          <p className="mt-2 text-[8px] text-slate-400">
            {assigned}/{product.quantity} places assigned
          </p>
          {error ? <p className="mt-1 text-[8px] text-red-600">{error}</p> : null}

          <button
            type="button"
            disabled={pending || Boolean(error)}
            onClick={() => {
              if (error) return
              onSave(
                product.packageId,
                layerTakesForDrafts(
                  drafts,
                  layers,
                  allocations,
                  orderId,
                  product.packageId,
                  product.ledgerPackageId,
                ),
              )
            }}
            className="mt-3 h-9 w-full rounded-md border border-primary text-[9px] font-semibold text-primary disabled:opacity-50"
          >
            Save allocation
          </button>
        </>
      )}
    </div>
  )
}
