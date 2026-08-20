"use client"

import { useEffect, useLayoutEffect, useState } from "react"
import type { AdminPackageRow, AdminRaceOption } from "@/lib/admin/queries"
import {
  clearCatalogClientCache,
  readCatalogClientCache,
  writeCatalogClientCache,
} from "@/lib/admin/catalog-client-cache"
import { fetchAdminCatalogList } from "@/app/(admin)/actions"
import { CatalogNewPackage } from "./catalog-new-package"
import { InventoryWorkspace } from "@/components/admin/inventory-workspace"

export function CatalogInventoryClient({ races }: { races: AdminRaceOption[] }) {
  const [rows, setRows] = useState<AdminPackageRow[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)

  useLayoutEffect(() => {
    const cached = readCatalogClientCache()
    if (cached?.rows.length) {
      setRows(cached.rows)
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadFresh() {
      clearCatalogClientCache()
      const fresh = await fetchAdminCatalogList()
      if (cancelled) return
      if (fresh.length > 0) {
        setRows(fresh)
        writeCatalogClientCache(fresh, races)
      }
      setListLoading(false)
    }
    void loadFresh()

    function onVisible() {
      if (document.visibilityState !== "visible") return
      void loadFresh()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [races])

  function handlePackageCreated() {
    clearCatalogClientCache()
    setListLoading(true)
    void fetchAdminCatalogList().then((fresh) => {
      if (fresh.length > 0) {
        setRows(fresh)
        writeCatalogClientCache(fresh, races)
      }
      setListLoading(false)
    })
  }

  return (
    <div>
      <CatalogNewPackage
        races={races}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handlePackageCreated}
      />

      {listLoading && rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground animate-pulse">
          Loading inventory…
        </div>
      ) : (
        <InventoryWorkspace
          initialRows={rows}
          mode="manage"
          onAddProduct={() => setCreateOpen(true)}
          onDataChanged={handlePackageCreated}
        />
      )}
    </div>
  )
}
