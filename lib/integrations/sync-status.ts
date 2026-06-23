import type { PackageSyncStatus } from "@/lib/integrations/types"

export function packageSyncStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "pending":
      return "Sync pending"
    case "synced":
      return "Synced"
    case "failed":
      return "Sync failed"
    case "idle":
    default:
      return "Not synced yet"
  }
}

export function packageSyncStatusClass(status: string | null | undefined): string {
  switch (status) {
    case "pending":
      return "bg-amber-100 text-amber-900 border-amber-200"
    case "synced":
      return "bg-emerald-100 text-emerald-900 border-emerald-200"
    case "failed":
      return "bg-red-100 text-red-900 border-red-200"
    default:
      return "bg-muted text-muted-foreground border-border"
  }
}

export function isPackageSyncStatus(s: string): s is PackageSyncStatus {
  return s === "idle" || s === "pending" || s === "synced" || s === "failed"
}
