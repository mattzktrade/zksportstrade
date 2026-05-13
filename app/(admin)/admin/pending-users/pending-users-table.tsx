"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import type { PortalProfile } from "@/lib/types/profile"
import { setProfileApproval } from "@/app/(admin)/actions"

export function PendingUsersTable({ profiles }: { profiles: PortalProfile[] }) {
  const [pending, start] = useTransition()
  const router = useRouter()

  async function act(id: string, status: "approved" | "rejected", note: string) {
    start(async () => {
      const res = await setProfileApproval(id, status, note || null)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(status === "approved" ? "User approved." : "User rejected.")
      router.refresh()
    })
  }

  if (profiles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-8 text-center">
        No pending signups.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="p-3 font-medium">Name</th>
            <th className="p-3 font-medium">Email</th>
            <th className="p-3 font-medium">Company</th>
            <th className="p-3 font-medium">Joined</th>
            <th className="p-3 font-medium w-[280px]">Actions</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <PendingRow key={p.id} profile={p} disabled={pending} onAct={act} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PendingRow({
  profile,
  disabled,
  onAct,
}: {
  profile: PortalProfile
  disabled: boolean
  onAct: (id: string, status: "approved" | "rejected", note: string) => void
}) {
  const [note, setNote] = useState("")

  return (
    <tr className="border-b border-border last:border-0">
      <td className="p-3 font-medium text-foreground">{profile.full_name || "—"}</td>
      <td className="p-3 text-muted-foreground">{profile.email}</td>
      <td className="p-3 text-muted-foreground">{profile.company_name || "—"}</td>
      <td className="p-3 text-muted-foreground whitespace-nowrap">
        {profile.created_at ? new Date(profile.created_at).toLocaleDateString() : "—"}
      </td>
      <td className="p-3 align-top space-y-2">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note (shown internally)"
          rows={2}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAct(profile.id, "approved", note)}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAct(profile.id, "rejected", note)}
            className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      </td>
    </tr>
  )
}
