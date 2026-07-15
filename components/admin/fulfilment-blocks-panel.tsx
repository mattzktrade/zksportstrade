"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  createFulfilmentBlock,
  deleteFulfilmentBlock,
  updateFulfilmentBlock,
} from "@/app/(admin)/actions"
import type { FulfilmentBlockWithUsage } from "@/lib/admin/fulfilment-blocks"

export function FulfilmentBlocksPanel({
  packageId,
  blocks,
}: {
  packageId: string
  blocks: FulfilmentBlockWithUsage[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState("")
  const [locationNote, setLocationNote] = useState("")

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editLocationNote, setEditLocationNote] = useState("")

  function resetAdd() {
    setName("")
    setLocationNote("")
  }

  function submitAdd() {
    if (!name.trim()) {
      toast.error("Block name is required.")
      return
    }
    start(async () => {
      const res = await createFulfilmentBlock({
        packageId,
        name: name.trim(),
        locationNote: locationNote.trim() || null,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Fulfilment block created.")
      resetAdd()
      setShowAdd(false)
      router.refresh()
    })
  }

  function startEdit(b: FulfilmentBlockWithUsage) {
    setEditingId(b.id)
    setEditName(b.name)
    setEditLocationNote(b.location_note ?? "")
  }

  function submitEdit(b: FulfilmentBlockWithUsage) {
    if (!editName.trim()) {
      toast.error("Block name is required.")
      return
    }
    start(async () => {
      const res = await updateFulfilmentBlock({
        id: b.id,
        packageId,
        name: editName.trim(),
        locationNote: editLocationNote,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Fulfilment block updated.")
      setEditingId(null)
      router.refresh()
    })
  }

  function confirmDelete(b: FulfilmentBlockWithUsage) {
    if (b.usage.layer_count > 0) {
      toast.error(
        `Cannot delete: ${b.usage.layer_count} cost layer${b.usage.layer_count === 1 ? "" : "s"} still assigned to this block.`,
      )
      return
    }
    if (!window.confirm(`Delete fulfilment block "${b.name}"?`)) return
    start(async () => {
      const res = await deleteFulfilmentBlock({ id: b.id, packageId })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Fulfilment block deleted.")
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Fulfilment blocks
          </p>
          <p className="text-xs text-muted-foreground/80 leading-relaxed">
            Optional. Split this package&rsquo;s stock into physical blocks (e.g. Paddock Suite A) so ops can
            keep multi-guest orders together. Cost layers can be assigned to a block after purchase.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted"
        >
          {showAdd ? "Cancel" : "Add block"}
        </button>
      </div>

      {showAdd ? (
        <div className="rounded-lg border border-border bg-muted/30 p-3 grid gap-2 sm:grid-cols-2">
          <label className="block text-xs text-muted-foreground">
            Block name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Paddock Suite A"
              className="mt-1 w-full px-2 py-1.5 rounded border border-border bg-background text-sm"
              maxLength={60}
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Location note (optional)
            <input
              value={locationNote}
              onChange={(e) => setLocationNote(e.target.value)}
              placeholder="e.g. Turn 1 grandstand, level 2"
              className="mt-1 w-full px-2 py-1.5 rounded border border-border bg-background text-sm"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => submitAdd()}
              className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
            >
              Save block
            </button>
          </div>
        </div>
      ) : null}

      {blocks.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No fulfilment blocks yet. This package will just track stock in one pool.
        </p>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-xs min-w-[500px]">
            <thead>
              <tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Block</th>
                <th className="px-3 py-2 font-medium">Location note</th>
                <th className="px-3 py-2 font-medium text-right">Layers</th>
                <th className="px-3 py-2 font-medium text-right">Bought</th>
                <th className="px-3 py-2 font-medium text-right">Remaining</th>
                <th className="px-3 py-2 font-medium min-w-[8rem]" />
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => {
                const editing = editingId === b.id
                return (
                  <tr key={b.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium">
                      {editing ? (
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full px-2 py-1 rounded border border-border bg-background text-xs"
                          maxLength={60}
                        />
                      ) : (
                        b.name
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {editing ? (
                        <input
                          value={editLocationNote}
                          onChange={(e) => setEditLocationNote(e.target.value)}
                          placeholder="Optional"
                          className="w-full px-2 py-1 rounded border border-border bg-background text-xs"
                        />
                      ) : (
                        b.location_note ?? "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {b.usage.layer_count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.usage.quantity_purchased}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {b.usage.quantity_remaining}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => submitEdit(b)}
                            className="text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => setEditingId(null)}
                            className="ml-3 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => startEdit(b)}
                            className="text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={pending || b.usage.layer_count > 0}
                            onClick={() => confirmDelete(b)}
                            className="ml-3 text-[11px] font-medium text-destructive hover:underline disabled:opacity-50"
                            title={
                              b.usage.layer_count > 0
                                ? `Unlink ${b.usage.layer_count} cost layer${b.usage.layer_count === 1 ? "" : "s"} first`
                                : "Delete block"
                            }
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
