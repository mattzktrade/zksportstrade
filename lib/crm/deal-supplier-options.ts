export type DealSupplierOption = {
  key: string
  supplierName: string
  remaining: number
  costLayerId: string | null
  supplierId: string | null
  unitCost: number | null
}

export function dealSupplierKey(input: {
  supplierId?: string | null
  source?: string | null
  layerId?: string | null
}): string {
  if (input.supplierId) return `sup:${input.supplierId}`
  const source = input.source?.trim().toLowerCase()
  if (source) return `src:${source}`
  if (input.layerId) return `layer:${input.layerId}`
  return "unassigned"
}
