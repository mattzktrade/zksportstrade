import { getCrmAccountOptions, getDealPackagePicker } from "@/lib/crm/deals"
import { getSalesStaffOptions } from "@/lib/crm/leads"
import { getSuppliers } from "@/lib/inventory/suppliers"
import type { DealWorkspaceOptions } from "@/lib/crm/deal-workspace-options"

export async function loadDealWorkspaceOptions(): Promise<DealWorkspaceOptions> {
  const [packagePicker, accountOptions, staffOptions, suppliers] = await Promise.all([
    getDealPackagePicker(),
    getCrmAccountOptions(),
    getSalesStaffOptions(),
    getSuppliers(),
  ])
  return {
    packageOptions: packagePicker.packageOptions,
    createPackageOptions: packagePicker.createPackageOptions,
    eventOptions: packagePicker.eventOptions,
    accountOptions,
    staffOptions,
    supplierOptions: suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name })),
  }
}
