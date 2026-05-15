"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { adminPackagePath, parseAdminPackageTab } from "@/lib/admin/package-link"

/** Redirects /admin/catalog?package=…&tab=… to /admin/catalog/[id] */
export function CatalogPackageRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const packageId = searchParams.get("package")?.trim()
  const tab = parseAdminPackageTab(searchParams.get("tab"))
  const pathTab = tab === "details" ? undefined : tab

  useEffect(() => {
    if (packageId) {
      router.replace(adminPackagePath(packageId, pathTab))
    }
  }, [packageId, pathTab, router])

  if (!packageId) return null
  return <p className="text-sm text-muted-foreground p-6">Opening package…</p>
}
