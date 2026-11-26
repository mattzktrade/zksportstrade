import type { DealBasketSupplier } from "@/components/admin/deal-line-basket"
import type { CrmAccountOption, DealEventOption, DealPackageOption } from "@/lib/crm/deal-types"
import type { StaffOption } from "@/lib/crm/lead-types"

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
