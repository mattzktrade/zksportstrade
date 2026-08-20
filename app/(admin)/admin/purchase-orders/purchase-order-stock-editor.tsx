"use client"

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react"
import Link from "next/link"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { addCostLayer, deleteCostLayer, updateCostLayer, updateCostLayerQuantity } from "@/app/(admin)/actions"
import { SearchableSelect } from "@/components/admin/searchable-select"
import { adminPackagePath } from "@/lib/admin/package-link"
import type { PurchaseOrderProductOption, PurchaseOrderStockLine } from "@/lib/admin/purchase-orders"
import { formatMoney } from "@/lib/format/money"

const inputClass =
  "h-8 w-full rounded-md border border-[#e4e6ea] bg-white px-2 text-xs tabular-nums outline-none focus:border-primary/40"

export type DraftPurchaseLine = {
  key: string
  packageId: string
  quantity: string
  unitCost: string
}

export function emptyDraftPurchaseLine(): DraftPurchaseLine {
  return { key: crypto.randomUUID(), packageId: "", quantity: "", unitCost: "" }
}

function productSelectOptions(products: PurchaseOrderProductOption[]) {
  return products.map((product) => ({
    value: product.id,
    label: `${product.eventName} · ${product.name}`,
  }))
}

function lineTotal(quantity: string, unitCost: string): number | null {
  const qty = Number(quantity)
  const cost = Number(unitCost)
  if (!Number.isFinite(qty) || !Number.isFinite(cost) || qty <= 0 || cost < 0) return null
  return Math.round(qty * cost * 100) / 100
}

function ProductLinesChrome({
  title,
  hint,
  totals,
  children,
}: {
  title: string
  hint?: string
  totals: { qty: number; amount: number }
  children: ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#eceef1] bg-white">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[#eceef1] bg-[#fafbfc] px-3 py-2.5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#62666e]">{title}</p>
          {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
        </div>
        <p className="text-[11px] tabular-nums text-[#62666e]">
          {totals.qty} unit{totals.qty === 1 ? "" : "s"}
          {totals.amount > 0 ? ` · ${formatMoney("USD", totals.amount)}` : ""}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-white text-[10px] uppercase tracking-wide text-[#92969e]">
            <tr>
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="w-28 px-3 py-2 font-medium">Qty</th>
              <th className="w-32 px-3 py-2 font-medium">Buy price</th>
              <th className="w-28 px-3 py-2 font-medium text-right">Line total</th>
              <th className="w-28 px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#eceef1]">{children}</tbody>
        </table>
      </div>
    </div>
  )
}

export function PurchaseOrderDraftLines({
  products,
  lines,
  onChange,
}: {
  products: PurchaseOrderProductOption[]
  lines: DraftPurchaseLine[]
  onChange: (lines: DraftPurchaseLine[]) => void
}) {
  const options = useMemo(() => productSelectOptions(products), [products])
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products])

  const totals = lines.reduce(
    (acc, line) => {
      const qty = Math.floor(Number(line.quantity))
      const total = lineTotal(line.quantity, line.unitCost)
      if (line.packageId && Number.isFinite(qty) && qty > 0) acc.qty += qty
      if (total != null) acc.amount += total
      return acc
    },
    { qty: 0, amount: 0 },
  )

  function update(key: string, patch: Partial<DraftPurchaseLine>) {
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  return (
    <ProductLinesChrome
      title="Products"
      hint="What this purchase order is buying — at least one product is required."
      totals={totals}
    >
      {lines.map((line) => {
        const product = productById.get(line.packageId)
        const total = lineTotal(line.quantity, line.unitCost)
        return (
          <tr key={line.key}>
            <td className="px-3 py-2">
              <SearchableSelect
                value={line.packageId}
                onChange={(value) => update(line.key, { packageId: value })}
                options={options}
                placeholder="Search event or product…"
                emptyLabel="No matching products"
                className="h-8 rounded-md border border-[#e4e6ea] bg-white px-2 text-xs"
              />
              {product ? (
                <p className="mt-1 text-[10px] text-muted-foreground">{product.eventName}</p>
              ) : null}
            </td>
            <td className="px-3 py-2">
              <input
                value={line.quantity}
                onChange={(e) => update(line.key, { quantity: e.target.value })}
                inputMode="numeric"
                placeholder="0"
                className={inputClass}
              />
            </td>
            <td className="px-3 py-2">
              <input
                value={line.unitCost}
                onChange={(e) => update(line.key, { unitCost: e.target.value })}
                inputMode="decimal"
                placeholder="0.00"
                className={inputClass}
              />
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
              {total != null ? formatMoney("USD", total) : "—"}
            </td>
            <td className="px-3 py-2 text-right">
              {lines.length > 1 ? (
                <button
                  type="button"
                  onClick={() => onChange(lines.filter((item) => item.key !== line.key))}
                  className="inline-flex h-8 items-center gap-1 text-[11px] font-medium text-destructive hover:underline"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove
                </button>
              ) : null}
            </td>
          </tr>
        )
      })}
      <tr>
        <td colSpan={5} className="px-3 py-2">
          <button
            type="button"
            onClick={() => onChange([...lines, emptyDraftPurchaseLine()])}
            className="inline-flex h-8 items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"
          >
            <Plus className="h-3.5 w-3.5" />
            Add another product
          </button>
        </td>
      </tr>
    </ProductLinesChrome>
  )
}

export function PurchaseOrderStockEditor({
  purchaseOrderId,
  lines,
  products,
  onChanged,
}: {
  purchaseOrderId: string
  lines: PurchaseOrderStockLine[]
  products: PurchaseOrderProductOption[]
  onChanged: () => void
}) {
  const [pending, start] = useTransition()
  const [drafts, setDrafts] = useState<Record<string, { qty: string; cost: string }>>({})
  const [addPackageId, setAddPackageId] = useState("")
  const [addQty, setAddQty] = useState("")
  const [addCost, setAddCost] = useState("")

  useEffect(() => {
    setDrafts({})
  }, [lines])

  const productOptions = useMemo(() => productSelectOptions(products), [products])
  const addProduct = products.find((product) => product.id === addPackageId)

  function draftFor(line: PurchaseOrderStockLine) {
    return drafts[line.layerId] ?? { qty: String(line.quantityPurchased), cost: String(line.unitCost) }
  }

  function isDirty(line: PurchaseOrderStockLine) {
    const draft = draftFor(line)
    return Number(draft.qty) !== line.quantityPurchased || Number(draft.cost) !== line.unitCost
  }

  const totals = lines.reduce(
    (acc, line) => {
      const draft = draftFor(line)
      const qty = Math.floor(Number(draft.qty))
      const cost = Number(draft.cost)
      acc.qty += Number.isFinite(qty) && qty > 0 ? qty : line.quantityPurchased
      acc.amount += (Number.isFinite(qty) && qty > 0 ? qty : line.quantityPurchased) * (Number.isFinite(cost) ? cost : line.unitCost)
      return acc
    },
    { qty: 0, amount: 0 },
  )

  function saveLine(line: PurchaseOrderStockLine) {
    const draft = draftFor(line)
    const qty = Math.floor(Number(draft.qty))
    const cost = Number(draft.cost)
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Quantity must be a positive whole number.")
      return
    }
    if (!Number.isFinite(cost) || cost < 0) {
      toast.error("Buy price must be a non-negative number.")
      return
    }
    const consumed = line.quantityPurchased - line.quantityRemaining
    if (qty < consumed) {
      toast.error(`Quantity cannot be less than ${consumed} (already sold from this line).`)
      return
    }
    start(async () => {
      if (qty !== line.quantityPurchased) {
        const qtyRes = await updateCostLayerQuantity({
          layerId: line.layerId,
          packageId: line.packageId,
          quantity: qty,
        })
        if (!qtyRes.ok) {
          toast.error(qtyRes.message)
          return
        }
      }
      if (cost !== line.unitCost) {
        const costRes = await updateCostLayer({
          layerId: line.layerId,
          packageId: line.packageId,
          unitCost: cost,
          cascadeToConsumptions: true,
        })
        if (!costRes.ok) {
          toast.error(costRes.message)
          return
        }
      }
      toast.success("Stock line updated.")
      onChanged()
    })
  }

  function removeLine(line: PurchaseOrderStockLine) {
    const sold = line.quantityPurchased - line.quantityRemaining
    if (sold > 0) {
      toast.error("Cannot delete this line while units from it are already sold.")
      return
    }
    if (
      !window.confirm(
        `Remove ${line.packageName} (${line.quantityPurchased} units @ ${formatMoney(line.currency, line.unitCost)}) from this purchase order? Stock will be reduced by ${line.quantityPurchased}.`,
      )
    ) {
      return
    }
    start(async () => {
      const res = await deleteCostLayer(line.layerId)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Product removed from this purchase order.")
      onChanged()
    })
  }

  function addLine() {
    if (!addPackageId) {
      toast.error("Choose a product.")
      return
    }
    const qty = Math.floor(Number(addQty))
    const cost = Number(addCost)
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Quantity must be a positive whole number.")
      return
    }
    if (!Number.isFinite(cost) || cost < 0) {
      toast.error("Buy price must be a non-negative number.")
      return
    }
    start(async () => {
      const res = await addCostLayer({
        packageId: addPackageId,
        quantity: qty,
        unitCost: cost,
        purchaseOrderId,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Product added to this purchase order.")
      setAddPackageId("")
      setAddQty("")
      setAddCost("")
      onChanged()
    })
  }

  const addTotal = lineTotal(addQty, addCost)

  return (
    <ProductLinesChrome
      title="Products"
      hint="Edit quantity and buy price directly. Save a line after you change it."
      totals={{ qty: totals.qty, amount: Math.round(totals.amount * 100) / 100 }}
    >
      {lines.map((line) => {
        const draft = draftFor(line)
        const dirty = isDirty(line)
        const sold = line.quantityPurchased - line.quantityRemaining
        const total = lineTotal(draft.qty, draft.cost)
        return (
          <tr key={line.layerId} className={dirty ? "bg-primary/[0.03]" : undefined}>
            <td className="px-3 py-2">
              <Link href={adminPackagePath(line.packageId)} className="font-medium text-primary hover:underline">
                {line.packageName}
              </Link>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {line.eventName}
                {sold > 0 ? ` · ${line.quantityRemaining} still unsold` : ""}
              </p>
            </td>
            <td className="px-3 py-2">
              <input
                value={draft.qty}
                onChange={(e) =>
                  setDrafts((current) => ({ ...current, [line.layerId]: { ...draft, qty: e.target.value } }))
                }
                inputMode="numeric"
                className={inputClass}
              />
            </td>
            <td className="px-3 py-2">
              <input
                value={draft.cost}
                onChange={(e) =>
                  setDrafts((current) => ({ ...current, [line.layerId]: { ...draft, cost: e.target.value } }))
                }
                inputMode="decimal"
                className={inputClass}
              />
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
              {total != null ? formatMoney(line.currency, total) : "—"}
            </td>
            <td className="px-3 py-2 text-right whitespace-nowrap">
              {dirty ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => saveLine(line)}
                  className="mr-2 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
                >
                  Save
                </button>
              ) : null}
              <button
                type="button"
                disabled={pending}
                onClick={() => removeLine(line)}
                className="text-[11px] font-medium text-destructive hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </td>
          </tr>
        )
      })}
      <tr className="bg-[#fafbfc]">
        <td className="px-3 py-2">
          <SearchableSelect
            value={addPackageId}
            onChange={setAddPackageId}
            options={productOptions}
            placeholder="Add a product…"
            emptyLabel="No matching products"
            className="h-8 rounded-md border border-[#e4e6ea] bg-white px-2 text-xs"
          />
          {addProduct ? <p className="mt-1 text-[10px] text-muted-foreground">{addProduct.eventName}</p> : null}
        </td>
        <td className="px-3 py-2">
          <input
            value={addQty}
            onChange={(e) => setAddQty(e.target.value)}
            inputMode="numeric"
            placeholder="Qty"
            className={inputClass}
          />
        </td>
        <td className="px-3 py-2">
          <input
            value={addCost}
            onChange={(e) => setAddCost(e.target.value)}
            inputMode="decimal"
            placeholder="Buy price"
            className={inputClass}
          />
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
          {addTotal != null ? formatMoney("USD", addTotal) : "—"}
        </td>
        <td className="px-3 py-2 text-right">
          <button
            type="button"
            disabled={pending}
            onClick={addLine}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </td>
      </tr>
    </ProductLinesChrome>
  )
}
