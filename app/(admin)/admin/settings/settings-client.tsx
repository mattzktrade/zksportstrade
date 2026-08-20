"use client"

import { useMemo, useState, useTransition, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  KeyRound,
  Plug,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"
import {
  AdminPageHeader,
  AdminPanel,
  StatusPill,
} from "@/components/admin/admin-page-kit"
import {
  CMS_ROLE_GUIDES,
  CMS_STAFF_ROLES,
  cmsRoleLabel,
  type CmsRole,
} from "@/lib/auth/permissions"
import { cn } from "@/lib/utils"
import type { SettingsStaffUser } from "@/lib/admin/settings-users"
import {
  createStaffUser,
  deleteStaffUser,
  updateStaffPassword,
  updateStaffRole,
} from "./settings-actions"

export type SettingsIntegrationCard = {
  href: string
  title: string
  description: string
  status: string
  connected: boolean
  muted?: boolean
}

type Tab = "users" | "integrations"

function dateLabel(value: string | null): string {
  if (!value) return "—"
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function roleTone(role: CmsRole): "red" | "blue" | "green" | "gray" {
  if (role === "admin") return "red"
  if (role === "finance") return "blue"
  if (role === "sales") return "green"
  return "gray"
}

export function SettingsClient({
  currentUserId,
  canManageUsers,
  users,
  integrations,
  nativeMode,
  initialTab,
}: {
  currentUserId: string
  canManageUsers: boolean
  users: SettingsStaffUser[]
  integrations: SettingsIntegrationCard[]
  nativeMode: boolean
  initialTab: Tab
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [search, setSearch] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [passwordUser, setPasswordUser] = useState<SettingsStaffUser | null>(null)
  const [deleteUser, setDeleteUser] = useState<SettingsStaffUser | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter((user) =>
      `${user.fullName} ${user.email} ${user.role}`.toLowerCase().includes(q),
    )
  }, [users, search])

  function changeRole(user: SettingsStaffUser, role: CmsRole) {
    if (role === user.role) return
    startTransition(async () => {
      const result = await updateStaffRole(user.id, role)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  return (
    <div className="space-y-3 p-4 lg:p-5">
      <AdminPageHeader
        title="Settings"
        description="Team logins, roles, and the services ZK connects to."
        action={
          tab === "users" && canManageUsers ? (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              New user
            </button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-1 border-b border-[#eceef1]">
        {canManageUsers ? (
          <TabButton active={tab === "users"} onClick={() => setTab("users")}>
            Team · {users.length}
          </TabButton>
        ) : null}
        <TabButton active={tab === "integrations"} onClick={() => setTab("integrations")}>
          Integrations · {integrations.filter((item) => item.connected).length} connected
        </TabButton>
      </div>

      {tab === "users" && canManageUsers ? (
        <>
          <AdminPanel>
            <div className="flex flex-wrap items-center gap-2 border-b border-[#eceef1] px-3 py-3">
              <div className="relative min-w-[220px] flex-1 sm:max-w-[340px]">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, email or role..."
                  className="h-8 w-full rounded-md border border-[#e5e7eb] bg-white pl-9 pr-3 text-[10px] outline-none placeholder:text-[#a0a3a9] focus:border-primary/40"
                />
              </div>
              <p className="ml-auto text-[10px] text-slate-400">
                Trade portal agents stay under Portal → Agents. This list is CMS staff only.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[10px]">
                <thead className="bg-[#fafbfc] text-[9px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Person</th>
                    <th className="px-4 py-2.5 font-medium">Login</th>
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-4 py-2.5 font-medium">Last sign in</th>
                    <th className="px-4 py-2.5 font-medium">Added</th>
                    <th className="px-4 py-2.5 font-medium"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f1f3]">
                  {filtered.map((user) => {
                    const you = user.id === currentUserId
                    return (
                      <tr key={user.id} className="align-top hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                              {user.fullName.trim().charAt(0).toUpperCase() || "U"}
                            </div>
                            <div>
                              <p className="font-semibold text-slate-800">
                                {user.fullName}
                                {you ? <span className="ml-1.5 text-[8px] font-medium text-slate-400">You</span> : null}
                              </p>
                              <p className="text-[8px] text-slate-400">{CMS_ROLE_GUIDES[user.role].summary}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium">{user.email}</p>
                          <p className="text-[8px] text-slate-400">Email + password</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1.5">
                            <StatusPill tone={roleTone(user.role)}>{cmsRoleLabel(user.role)}</StatusPill>
                            <select
                              value={user.role}
                              disabled={pending}
                              onChange={(e) => changeRole(user, e.target.value as CmsRole)}
                              className="h-7 max-w-[140px] rounded-md border border-[#e5e7eb] bg-white px-2 text-[9px] disabled:opacity-50"
                            >
                              {CMS_STAFF_ROLES.map((role) => (
                                <option key={role} value={role}>
                                  {cmsRoleLabel(role)}
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500">{dateLabel(user.lastSignInAt)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500">{dateLabel(user.createdAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => setPasswordUser(user)}
                              className="inline-flex items-center gap-1 text-[8px] font-semibold text-primary disabled:opacity-50"
                            >
                              <KeyRound className="h-3 w-3" />
                              Set password
                            </button>
                            {you ? null : (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => setDeleteUser(user)}
                                className="inline-flex items-center gap-1 text-[8px] font-semibold text-slate-400 hover:text-red-600 disabled:opacity-50"
                              >
                                <Trash2 className="h-3 w-3" />
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                        No team members match that search.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </AdminPanel>
        </>
      ) : null}

      {tab === "integrations" ? (
        <div className="space-y-3">
          {nativeMode ? (
            <div className="rounded-lg border border-primary/20 bg-red-50/60 px-4 py-3">
              <p className="text-[11px] font-semibold text-slate-800">Native platform mode is on</p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                Xero and Wix still run from this CMS. Salesforce is left in place but not used.
              </p>
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {integrations.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-[168px] flex-col rounded-lg border border-[#eceef1] bg-white p-5 transition-colors hover:border-primary/40",
                  item.muted && "opacity-80",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-50 text-slate-700">
                    <Plug className="h-4 w-4" />
                  </div>
                  <StatusPill tone={item.connected ? "green" : item.muted ? "gray" : "amber"}>
                    {item.connected ? "Connected" : item.muted ? "Idle" : "Setup needed"}
                  </StatusPill>
                </div>
                <p className="mt-4 text-[13px] font-semibold text-slate-800">{item.title}</p>
                <p className="mt-1 flex-1 text-[10px] leading-relaxed text-slate-500">{item.description}</p>
                <p className="mt-4 text-[10px] font-medium text-slate-700">{item.status}</p>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {showCreate ? (
        <CreateUserModal
          pending={pending}
          onClose={() => setShowCreate(false)}
          onCreate={(input) => {
            startTransition(async () => {
              const result = await createStaffUser(input)
              if (!result.ok) {
                toast.error(result.message)
                return
              }
              toast.success(result.message)
              setShowCreate(false)
              router.refresh()
            })
          }}
        />
      ) : null}

      {passwordUser ? (
        <PasswordModal
          user={passwordUser}
          pending={pending}
          onClose={() => setPasswordUser(null)}
          onSave={(password) => {
            startTransition(async () => {
              const result = await updateStaffPassword(passwordUser.id, password)
              if (!result.ok) {
                toast.error(result.message)
                return
              }
              toast.success(result.message)
              setPasswordUser(null)
              router.refresh()
            })
          }}
        />
      ) : null}

      {deleteUser ? (
        <DeleteModal
          user={deleteUser}
          pending={pending}
          onClose={() => setDeleteUser(null)}
          onConfirm={() => {
            startTransition(async () => {
              const result = await deleteStaffUser(deleteUser.id)
              if (!result.ok) {
                toast.error(result.message)
                return
              }
              toast.success(result.message)
              setDeleteUser(null)
              router.refresh()
            })
          }}
        />
      ) : null}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px border-b-2 px-3 py-2 text-[11px] font-medium",
        active ? "border-primary text-primary" : "border-transparent text-slate-500 hover:text-slate-800",
      )}
    >
      {children}
    </button>
  )
}

function CreateUserModal({
  pending,
  onClose,
  onCreate,
}: {
  pending: boolean
  onClose: () => void
  onCreate: (input: { fullName: string; email: string; password: string; role: CmsRole }) => void
}) {
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [role, setRole] = useState<CmsRole>("sales")
  const guide = CMS_ROLE_GUIDES[role]

  function submit() {
    if (password !== confirm) {
      toast.error("Passwords do not match.")
      return
    }
    onCreate({ fullName, email, password, role })
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 pt-6">
          <div>
            <h2 className="text-lg font-semibold">New team user</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              They sign in at the same login page with the email and password you set here.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="no-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Name</span>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Alex Morgan"
              className="h-11 w-full rounded-md border px-3"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Email / login</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@zksports.com"
              className="h-11 w-full rounded-md border px-3"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="h-11 w-full rounded-md border px-3"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Confirm password</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="h-11 w-full rounded-md border px-3"
              />
            </label>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Role</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {CMS_STAFF_ROLES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRole(option)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left",
                    role === option ? "border-primary bg-red-50" : "border-[#e5e7eb] hover:border-slate-300",
                  )}
                >
                  <p className="text-[12px] font-semibold">{CMS_ROLE_GUIDES[option].label}</p>
                  <p className="mt-0.5 text-[9px] leading-snug text-slate-500">{CMS_ROLE_GUIDES[option].summary}</p>
                </button>
              ))}
            </div>
            <ul className="mt-3 space-y-1 rounded-lg bg-slate-50 px-3 py-2.5 text-[10px] text-slate-600">
              {guide.can.map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#eceef1] px-6 py-4">
          <button type="button" onClick={onClose} className="h-9 rounded-md px-3 text-[11px] text-slate-500">
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={submit}
            className="h-9 rounded-md bg-primary px-4 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            Create login
          </button>
        </div>
      </div>
    </div>
  )
}

function PasswordModal({
  user,
  pending,
  onClose,
  onSave,
}: {
  user: SettingsStaffUser
  pending: boolean
  onClose: () => void
  onSave: (password: string) => void
}) {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")

  function submit() {
    if (password !== confirm) {
      toast.error("Passwords do not match.")
      return
    }
    onSave(password)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Set password</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Replace the login password for {user.fullName} ({user.email}).
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-5 space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">New password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="h-11 w-full rounded-md border px-3"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Confirm password</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="h-11 w-full rounded-md border px-3"
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-md px-3 text-[11px] text-slate-500">
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={submit}
            className="h-9 rounded-md bg-primary px-4 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            Save password
          </button>
        </div>
      </div>
    </div>
  )
}

function DeleteModal({
  user,
  pending,
  onClose,
  onConfirm,
}: {
  user: SettingsStaffUser
  pending: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">Delete {user.fullName}?</h2>
        <p className="mt-2 text-sm text-slate-500">
          This removes their login ({user.email}) and they will no longer be able to open the CMS. Trade portal
          agents are not affected.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-md px-3 text-[11px] text-slate-500">
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className="h-9 rounded-md bg-primary px-4 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            Delete user
          </button>
        </div>
      </div>
    </div>
  )
}
