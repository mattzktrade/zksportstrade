"use client"

import { useMemo, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { searchAdminProductOptions } from "@/lib/admin/option-search"
import { cn } from "@/lib/utils"

export type DealBasketProduct = {
  id: string
  eventName: string
  packageName: string
  label: string
  price: number | null
  currency: string
  stockLeft: number
  netStock?: number
}

export type DealBasketSupplier = {
  id: string
  name: string
}

export type DealNumericField = number | ""

export type DealBasketLine = {
  key: string
  packageId: string
  quantity: DealNumericField
  unitPrice: DealNumericField
  sourcingMode: "owned" | "brokered"
  supplierId: string
  expectedUnitCost: number | null
  supplierQuoteAt: string
}

function parseDealNumericField(value: string): DealNumericField {
  if (value.trim() === "") return ""
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : ""
}

export function numericDealField(value: DealNumericField): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

export function isPricedDealBasketLine(line: DealBasketLine): boolean {
  return (
    typeof line.quantity === "number" &&
    Number.isFinite(line.quantity) &&
    line.quantity >= 1 &&
    typeof line.unitPrice === "number" &&
    Number.isFinite(line.unitPrice) &&
    line.unitPrice >= 0
  )
}

function localDateTimeValue(date = new Date()): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

export function createDealBasketLine(product: DealBasketProduct): DealBasketLine {
  return {
    key: globalThis.crypto?.randomUUID?.() ?? `${product.id}-${Date.now()}`,
    packageId: product.id,
    quantity: 1,
    unitPrice: Number(product.price ?? 0),
    sourcingMode: "owned",
    supplierId: "",
    expectedUnitCost: null,
    supplierQuoteAt: "",
  }
}

export function DealLineBasket({
  products,
  suppliers,
  lines,
  onChange,
  compact = false,
}: {
  products: DealBasketProduct[]
  suppliers: DealBasketSupplier[]
  lines: DealBasketLine[]
  onChange: (lines: DealBasketLine[]) => void
  compact?: boolean
}) {
  const [search, setSearch] = useState("")
  const results = useMemo(
    () => searchAdminProductOptions(products, search),
    [products, search],
  )

  function updateLine(key: string, patch: Partial<DealBasketLine>) {
    onChange(lines.map((line) => line.key === key ? { ...line, ...patch } : line))
  }

  function addProduct(product: DealBasketProduct) {
    onChange([...lines, createDealBasketLine(product)])
    setSearch("")
  }

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        {lines.map((line, index) => {
          const product = products.find((option) => option.id === line.packageId)
          if (!product) return null
          const quantity = numericDealField(line.quantity)
          const unitPrice = numericDealField(line.unitPrice)
          const expectedProfit =
            line.expectedUnitCost == null
              ? null
              : (unitPrice - Number(line.expectedUnitCost)) * quantity
          return (
            <div key={line.key} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={cn("font-semibold", compact ? "text-[9px]" : "text-sm")}>
                    {index + 1}. {product.packageName}
                  </p>
                  <p className={cn("text-slate-500", compact ? "text-[8px]" : "text-xs")}>{product.eventName}</p>
                </div>
                <button type="button" disabled={lines.length === 1} onClick={() => onChange(lines.filter((item) => item.key !== line.key))} className="text-slate-400 disabled:opacity-20" title="Remove product">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className={cn("mt-3 grid gap-2", compact ? "grid-cols-2" : "md:grid-cols-4")}>
                <label className={compact ? "text-[8px]" : "text-xs"}>
                  <span className="mb-1 block text-slate-500">Quantity</span>
                  <input
                    type="number"
                    min={1}
                    value={line.quantity}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => updateLine(line.key, { quantity: parseDealNumericField(event.target.value) })}
                    className="h-9 w-full rounded-md border px-2"
                  />
                </label>
                <label className={compact ? "text-[8px]" : "text-xs"}>
                  <span className="mb-1 block text-slate-500">Sale price per person</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.unitPrice}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => updateLine(line.key, { unitPrice: parseDealNumericField(event.target.value) })}
                    className="h-9 w-full rounded-md border px-2"
                  />
                </label>
                <label className={compact ? "text-[8px]" : "text-xs"}>
                  <span className="mb-1 block text-slate-500">Stock source</span>
                  <select
                    value={line.sourcingMode}
                    onChange={(event) => {
                      const sourcingMode = event.target.value as "owned" | "brokered"
                      updateLine(line.key, {
                        sourcingMode,
                        supplierQuoteAt: sourcingMode === "brokered" && !line.supplierQuoteAt
                          ? localDateTimeValue()
                          : line.supplierQuoteAt,
                      })
                    }}
                    className="h-9 w-full rounded-md border bg-white px-2"
                  >
                    <option value="owned">Our stock</option>
                    <option value="brokered">Brokered stock</option>
                  </select>
                </label>
                <div className={cn("rounded-md px-2 py-1.5", product.stockLeft >= quantity ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
                  <p className={compact ? "text-[8px]" : "text-xs"}>Advertised: {product.currency} {Number(product.price ?? 0).toLocaleString()}</p>
                  <p className={cn("font-semibold", compact ? "text-[8px]" : "text-xs")}>
                    {product.stockLeft} in stock
                  </p>
                  {product.netStock != null && product.netStock < 0 ? (
                    <p className={compact ? "text-[8px]" : "text-xs"}>
                      Net stock {product.netStock} — use brokered stock or add a purchase
                    </p>
                  ) : null}
                </div>
              </div>

              {line.sourcingMode === "brokered" ? (
                <div className={cn("mt-2 grid gap-2 rounded-md bg-amber-50 p-2", compact ? "grid-cols-2" : "md:grid-cols-3")}>
                  <label className={compact ? "text-[8px]" : "text-xs"}>
                    <span className="mb-1 block text-amber-800">Supplier</span>
                    <select value={line.supplierId} onChange={(event) => updateLine(line.key, { supplierId: event.target.value })} className="h-9 w-full rounded-md border bg-white px-2">
                      <option value="">Select supplier…</option>
                      {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                    </select>
                  </label>
                  <label className={compact ? "text-[8px]" : "text-xs"}>
                    <span className="mb-1 block text-amber-800">Quoted buy price</span>
                    <input type="number" min={0} step="0.01" value={line.expectedUnitCost ?? ""} onChange={(event) => updateLine(line.key, { expectedUnitCost: event.target.value === "" ? null : Number(event.target.value) })} className="h-9 w-full rounded-md border bg-white px-2" />
                  </label>
                  <label className={compact ? "text-[8px]" : "text-xs"}>
                    <span className="mb-1 block text-amber-800">Quote received</span>
                    <input type="datetime-local" value={line.supplierQuoteAt} onChange={(event) => updateLine(line.key, { supplierQuoteAt: event.target.value })} className="h-9 w-full rounded-md border bg-white px-2" />
                  </label>
                  {expectedProfit != null ? (
                    <p className={cn("self-end pb-2 font-medium text-amber-800", compact ? "text-[8px]" : "text-xs")}>
                      Expected line profit: {product.currency} {expectedProfit.toLocaleString()}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="relative">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search another event or product…" className={cn("h-9 flex-1 rounded-md border bg-white px-3", compact ? "text-[9px]" : "text-sm")} />
        </div>
        {results.length > 0 ? (
          <div className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-md border bg-white p-1 shadow-xl">
            {results.map((product) => (
              <button key={product.id} type="button" onClick={() => addProduct(product)} className="block w-full rounded px-3 py-2 text-left hover:bg-slate-50">
                <span className={cn("block font-medium", compact ? "text-[9px]" : "text-sm")}>{product.packageName}</span>
                <span className={cn("text-slate-500", compact ? "text-[8px]" : "text-xs")}>
                  {product.eventName} · {product.stockLeft} available
                  {product.netStock != null && product.netStock < 0
                    ? ` · net stock ${product.netStock}`
                    : ""}
                </span>
              </button>
            ))}
            {results.length > 6 ? (
              <p className={cn("px-3 py-1.5 text-slate-400", compact ? "text-[8px]" : "text-[10px]")}>
                {results.length} matching products — scroll or type more to narrow
              </p>
            ) : null}
          </div>
        ) : search.trim() ? (
          <div className="absolute z-30 mt-1 w-full rounded-md border bg-white p-1 shadow-xl">
            <p className={cn("px-3 py-2 text-slate-400", compact ? "text-[8px]" : "text-sm")}>
              No matching products
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

