"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { CheckCircle2, KeyRound, ListTodo, Loader2, Map as MapIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { PasswordInput } from "@/components/password-input"
import type { RoadmapProject, StaffTodo } from "@/lib/admin/personal-space"
import { changeOwnPassword } from "./actions"
import { RoadmapBoard } from "./roadmap-board"
import { TodoList } from "./todo-list"

export type ProfileTab = "todos" | "roadmap" | "password"

const ROLE_LABELS: Record<string, string> = { admin: "Admin", finance: "Finance", sales: "Sales" }

function tabFrom(value: string | null, roadmapAllowed: boolean, fallback: ProfileTab): ProfileTab {
  if (value === "password" || value === "todos") return value
  if (value === "roadmap" && roadmapAllowed) return "roadmap"
  return fallback
}

export function ProfileClient({
  name,
  email,
  role,
  initialTab,
  roadmapAllowed,
  initialTodos,
  initialProjects,
  loadError,
}: {
  name: string
  email: string
  role: string
  initialTab: ProfileTab
  roadmapAllowed: boolean
  initialTodos: StaffTodo[]
  initialProjects: RoadmapProject[]
  loadError: string | null
}) {
  const searchParams = useSearchParams()
  const tab = tabFrom(searchParams.get("tab"), roadmapAllowed, initialTab)

  function selectTab(next: ProfileTab) {
    const url = new URL(window.location.href)
    if (next === "todos") url.searchParams.delete("tab")
    else url.searchParams.set("tab", next)
    window.history.replaceState(null, "", `${url.pathname}${url.search}`)
  }

  const tabs: Array<{ id: ProfileTab; label: string; icon: typeof ListTodo }> = [
    { id: "todos", label: "To-do list", icon: ListTodo },
    ...(roadmapAllowed ? [{ id: "roadmap" as const, label: "Roadmap", icon: MapIcon }] : []),
    { id: "password", label: "Password", icon: KeyRound },
  ]

  return (
    <div className={cn("mx-auto space-y-3 p-3 sm:p-4 lg:p-5", tab === "roadmap" ? "max-w-[1100px]" : "max-w-[820px]")}>
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[15px] font-semibold text-white">
          {name.trim().charAt(0).toUpperCase() || "A"}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-[20px] font-semibold tracking-[-0.02em] text-[#18191c]">{name}</h1>
          <p className="truncate text-[12px] text-[#80848d]">
            {email}
            {ROLE_LABELS[role] ? ` · ${ROLE_LABELS[role]}` : ""}
          </p>
        </div>
      </div>

      <div className="flex w-full gap-1 overflow-x-auto rounded-lg border border-[#eceef1] bg-white p-1 sm:w-fit">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => selectTab(item.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-[12px] font-medium transition-colors sm:flex-none sm:px-4",
              tab === item.id ? "bg-slate-900 text-white" : "text-[#5f636b] hover:bg-slate-50",
            )}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        ))}
      </div>

      {loadError ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">{loadError}</p>
      ) : null}

      <div hidden={tab !== "todos"}>
        <TodoList initialTodos={initialTodos} />
      </div>
      {roadmapAllowed ? (
        <div hidden={tab !== "roadmap"}>
          <p className="mb-3 text-[12px] text-[#80848d]">
            Only you can see this. Click a project to see its subtasks; tick them off as you go.
          </p>
          <RoadmapBoard initialProjects={initialProjects} />
        </div>
      ) : null}
      <div hidden={tab !== "password"}>
        <PasswordForm />
      </div>
    </div>
  )
}

function PasswordForm() {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setMessage(null)
    setDone(false)
    if (next.length < 8) {
      setMessage("New password must be at least 8 characters.")
      return
    }
    if (next !== confirm) {
      setMessage("The new passwords do not match.")
      return
    }
    setSaving(true)
    const result = await changeOwnPassword({ currentPassword: current, newPassword: next })
    setSaving(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setCurrent("")
    setNext("")
    setConfirm("")
    setDone(true)
    toast.success("Password changed")
  }

  const fieldClass =
    "h-10 w-full rounded-md border border-[#e5e7eb] bg-white px-3 text-[13px] outline-none focus:border-primary/40"

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="max-w-md space-y-3 rounded-lg border border-[#eceef1] bg-white p-4"
    >
      <div>
        <h2 className="text-[14px] font-semibold text-[#25272b]">Change password</h2>
        <p className="mt-0.5 text-[12px] text-[#80848d]">You stay signed in on this device after changing it.</p>
      </div>

      {message ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{message}</p>
      ) : null}
      {done ? (
        <p className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          Password changed. Use the new one next time you sign in.
        </p>
      ) : null}

      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-[#25272b]">Current password</span>
        <PasswordInput
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
          required
          className={fieldClass}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-[#25272b]">New password</span>
        <PasswordInput
          value={next}
          onChange={(event) => setNext(event.target.value)}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          required
          minLength={8}
          className={fieldClass}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-[#25272b]">Confirm new password</span>
        <PasswordInput
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
          className={fieldClass}
        />
      </label>
      <button
        type="submit"
        disabled={saving}
        className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-[13px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50 sm:w-auto sm:px-5"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Change password
      </button>
    </form>
  )
}
