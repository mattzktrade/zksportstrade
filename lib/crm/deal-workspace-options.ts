import type { DealBasketSupplier } from "@/components/admin/deal-line-basket"
import { getCrmAccountOptions, getDealPackagePicker } from "@/lib/crm/deals"
import type { CrmAccountOption, DealEventOption, DealPackageOption } from "@/lib/crm/deal-types"
import { getSalesStaffOptions } from "@/lib/crm/leads"
import type { StaffOption } from "@/lib/crm/lead-types"
import { getSuppliers } from "@/lib/inventory/suppliers"

export type DealWorkspaceOptions = {
  packageOptions: DealPackageOption[]
  createPackageOptions: DealPackageOption[]
  eventOptions: DealEventOption[]
  accountOptions: CrmAccountOption[]
  staffOptions: StaffOption[]
  supplierOptions: DealBasketSupplier[]
}

export const EMPTY_DEAL_WORKSPACE_OPTIONS: DealWorkspaceOptions = {
  packageOptions: [],
  createPackageOptions: [],
  eventOptions: [],
  accountOptions: [],
  staffOptions: [],
  supplierOptions: [],
}

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
