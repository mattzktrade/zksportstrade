import { revalidatePath } from "next/cache"

export function revalidateNativeBookingFormPages(dealId?: string | null) {
  revalidatePath("/admin/deals", "layout")
  revalidatePath("/admin")
  const id = typeof dealId === "string" ? dealId.trim() : ""
  if (id) revalidatePath(`/admin/deals/${id}`)
}
