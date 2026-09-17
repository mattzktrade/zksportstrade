export type DealSupplierSplitLine = {
  id: string
  quantity: number
  supplierKey: string
  supplierName: string | null
  supplierAllocations: Array<{ key: string; name: string; quantity: number }>
}

export type DealSupplierSlice = {
  name: string
  quantity: number
}

function storedSupplierKeys(line: DealSupplierSplitLine): string[] {
  if (line.supplierKey) return [line.supplierKey]
  return [...new Set(line.supplierAllocations.map((row) => row.key).filter(Boolean))]
}

function addSlice(totals: Map<string, number>, name: string, quantity: number) {
  const label = name.trim()
  const qty = Math.max(0, Math.floor(Number(quantity) || 0))
  if (!label || qty <= 0) return
  totals.set(label, (totals.get(label) ?? 0) + qty)
}

/** Guest counts by supplier for a signed deal, including leftover splits and multi-line deals. */
export function dealAssignedSupplierSlices(
  lines: readonly DealSupplierSplitLine[],
  drafts: Record<string, string> = {},
  supplierNameByKey: ReadonlyMap<string, string> = new Map(),
): DealSupplierSlice[] {
  const totals = new Map<string, number>()
  for (const line of lines) {
    const draftKey = drafts[line.id]
    const storedKeys = storedSupplierKeys(line)
    const draftUnchanged = Boolean(draftKey && storedKeys.length === 1 && storedKeys[0] === draftKey)
    if (draftKey && !draftUnchanged) {
      addSlice(totals, supplierNameByKey.get(draftKey) ?? "", line.quantity)
      continue
    }
    const allocations = line.supplierAllocations.filter((row) => row.quantity > 0 && row.name.trim())
    if (allocations.length > 0) {
      for (const allocation of allocations) {
        addSlice(totals, allocation.name, allocation.quantity)
      }
      continue
    }
    addSlice(
      totals,
      line.supplierName?.trim() || (line.supplierKey ? supplierNameByKey.get(line.supplierKey) ?? "" : ""),
      line.quantity,
    )
  }
  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name, quantity]) => ({ name, quantity }))
}

export function dealUnassignedPurchasedQuantity(
  lines: readonly DealSupplierSplitLine[],
  drafts: Record<string, string> = {},
): number {
  let assigned = 0
  let required = 0
  for (const line of lines) {
    const quantity = Math.max(0, Math.floor(Number(line.quantity) || 0))
    required += quantity
    if (drafts[line.id]) {
      assigned += quantity
      continue
    }
    assigned += line.supplierAllocations.reduce(
      (sum, allocation) => sum + Math.max(0, Math.floor(Number(allocation.quantity) || 0)),
      0,
    )
  }
  return Math.max(0, required - assigned)
}

/** True when leftover purchased stock cannot cover the unassigned guests on one supplier. */
export function dealIsOversoldUnassigned(
  unassignedQty: number,
  poolRemainings: readonly number[],
): boolean {
  const needed = Math.max(0, Math.floor(Number(unassignedQty) || 0))
  if (needed <= 0) return false
  if (poolRemainings.length === 0) return true
  return poolRemainings.every((remaining) => (Number(remaining) || 0) < needed)
}

export function dealLineSelectedSupplierKeys(
  line: DealSupplierSplitLine,
  draftKey?: string,
): string[] {
  if (draftKey) return [draftKey]
  return storedSupplierKeys(line)
}
