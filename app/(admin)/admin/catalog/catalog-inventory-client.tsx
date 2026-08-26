"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
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
  const [listError, setListError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const refreshPromise = useRef<Promise<AdminPackageRow[]> | null>(null)
  const lastRefreshAt = useRef(0)

  function requestFreshRows(): Promise<AdminPackageRow[]> {
    if (refreshPromise.current) return refreshPromise.current
    const request = fetchAdminCatalogList()
    refreshPromise.current = request
    void request.then(
      () => {
        if (refreshPromise.current === request) refreshPromise.current = null
      },
      () => {
        if (refreshPromise.current === request) refreshPromise.current = null
      },
    )
    return request
  }

  useLayoutEffect(() => {
    const cached = readCatalogClientCache()
    if (cached?.rows.length) {
      setRows(cached.rows)
      setListLoading(false)
      lastRefreshAt.current = cached.fetchedAt
    }
  }, [])

  useEffect(() => {
    let active = true
    async function loadFresh(force = false) {
      if (!force && Date.now() - lastRefreshAt.current < 60_000) {
        if (active) setListLoading(false)
        return
      }
      try {
        const fresh = await requestFreshRows()
        if (!active) return
        setListError(null)
        if (fresh.length > 0) {
          setRows(fresh)
          writeCatalogClientCache(fresh, races)
          lastRefreshAt.current = Date.now()
        }
        setListLoading(false)
      } catch (error) {
        if (!active) return
        setListError(error instanceof Error ? error.message : "Inventory could not be loaded.")
        setListLoading(false)
      }
    }
    void loadFresh()

    function onVisible() {
      if (document.visibilityState !== "visible") return
      void loadFresh()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      active = false
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [races])

  function handlePackageCreated() {
    clearCatalogClientCache()
    setListLoading(true)
    setListError(null)
    lastRefreshAt.current = 0
    void requestFreshRows()
      .then((fresh) => {
        if (fresh.length > 0) {
          setRows(fresh)
          writeCatalogClientCache(fresh, races)
          lastRefreshAt.current = Date.now()
        }
      })
      .catch((error) => {
        setListError(error instanceof Error ? error.message : "Inventory could not be loaded.")
      })
      .finally(() => setListLoading(false))
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
      ) : listError && rows.length === 0 ? (
        <div className="rounded-xl border border-destructive/30 bg-card p-8 text-center text-sm">
          <p className="text-destructive">{listError}</p>
          <button
            type="button"
            className="mt-3 rounded-md border border-border px-3 py-1.5 font-medium"
            onClick={handlePackageCreated}
          >
            Try again
          </button>
        </div>
      ) : (
        <InventoryWorkspace
          initialRows={rows}
          mode="manage"
          onAddProduct={() => {
            setCreateOpen(true)
            document.getElementById("admin-new-package")?.scrollIntoView({ behavior: "smooth", block: "start" })
          }}
          onDataChanged={handlePackageCreated}
        />
      )}
    </div>
  )
}
