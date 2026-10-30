"use client"

import { useMemo, useState } from "react"
import { CalendarDays, Check, ChevronDown, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { dueState, type DueState, type StaffTodo } from "@/lib/admin/personal-space"
import { addTodo, clearCompletedTodos, deleteTodo, updateTodo } from "./actions"
import { formatDueDate, useToday } from "./use-today"

const DUE_STYLES: Record<DueState, string> = {
  none: "",
  overdue: "bg-red-50 text-red-700",
  today: "bg-amber-50 text-amber-700",
  soon: "bg-blue-50 text-blue-700",
  later: "bg-slate-100 text-slate-600",
}

function dueLabel(date: string, state: DueState): string {
  if (state === "overdue") return `Overdue · ${formatDueDate(date)}`
  if (state === "today") return "Today"
  return formatDueDate(date)
}

function sortOpen(a: StaffTodo, b: StaffTodo): number {
  if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1
  if (a.due_date && !b.due_date) return -1
  if (!a.due_date && b.due_date) return 1
  return a.position - b.position
}

export function TodoList({ initialTodos }: { initialTodos: StaffTodo[] }) {
  const today = useToday()
  const [todos, setTodos] = useState(initialTodos)
  const [title, setTitle] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)

  const open = useMemo(() => todos.filter((todo) => !todo.done_at).sort(sortOpen), [todos])
  const done = useMemo(
    () => todos.filter((todo) => todo.done_at).sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? "")),
    [todos],
  )
  const overdueCount = open.filter((todo) => dueState(todo.due_date, today) === "overdue").length

  function replace(next: StaffTodo) {
    setTodos((list) => list.map((todo) => (todo.id === next.id ? next : todo)))
  }

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || adding) return
    setAdding(true)
    const result = await addTodo({ title, dueDate: dueDate || null })
    setAdding(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    setTodos((list) => [...list, result.data])
    setTitle("")
    setDueDate("")
  }

  async function patch(todo: StaffTodo, changes: Parameters<typeof updateTodo>[1]) {
    const optimistic: StaffTodo = {
      ...todo,
      ...(changes.title !== undefined ? { title: changes.title } : {}),
      ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
      ...(changes.dueDate !== undefined ? { due_date: changes.dueDate || null } : {}),
      ...(changes.done !== undefined ? { done_at: changes.done ? new Date().toISOString() : null } : {}),
    }
    replace(optimistic)
    const result = await updateTodo(todo.id, changes)
    if (!result.ok) {
      replace(todo)
      toast.error(result.message)
      return
    }
    replace(result.data)
  }

  async function remove(todo: StaffTodo) {
    setTodos((list) => list.filter((item) => item.id !== todo.id))
    const result = await deleteTodo(todo.id)
    if (!result.ok) {
      setTodos((list) => [...list, todo])
      toast.error(result.message)
    }
  }

  async function clearDone() {
    const previous = todos
    setTodos((list) => list.filter((todo) => !todo.done_at))
    const result = await clearCompletedTodos()
    if (!result.ok) {
      setTodos(previous)
      toast.error(result.message)
    }
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={(event) => void handleAdd(event)}
        className="flex flex-col gap-2 rounded-lg border border-[#eceef1] bg-white p-3 sm:flex-row sm:items-center"
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a to-do and press Enter"
          maxLength={300}
          className="h-10 min-w-0 flex-1 rounded-md border border-[#e5e7eb] px-3 text-[13px] outline-none placeholder:text-[#a0a3a9] focus:border-primary/40"
        />
        <div className="flex gap-2">
          <label className="relative flex h-10 flex-1 items-center sm:flex-none">
            <span className="sr-only">Due date (optional)</span>
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="h-10 w-full rounded-md border border-[#e5e7eb] px-3 text-[12px] text-[#5f636b] outline-none focus:border-primary/40 sm:w-[150px]"
            />
          </label>
          <button
            type="submit"
            disabled={adding || !title.trim()}
            className="flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-[#eceef1] bg-white">
        <div className="flex items-center justify-between border-b border-[#eceef1] px-4 py-3">
          <h2 className="text-[13px] font-semibold text-[#25272b]">
            To do <span className="font-normal text-[#80848d]">({open.length})</span>
          </h2>
          {overdueCount ? (
            <span className="rounded bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
              {overdueCount} overdue
            </span>
          ) : null}
        </div>

        {open.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-[#80848d]">
            Nothing on your list. Add something above.
          </p>
        ) : (
          <ul className="divide-y divide-[#f0f1f3]">
            {open.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                today={today}
                expanded={openId === todo.id}
                onToggleExpand={() => setOpenId((id) => (id === todo.id ? null : todo.id))}
                onPatch={(changes) => void patch(todo, changes)}
                onDelete={() => void remove(todo)}
              />
            ))}
          </ul>
        )}
      </div>

      {done.length ? (
        <div className="overflow-hidden rounded-lg border border-[#eceef1] bg-white">
          <div className="flex items-center justify-between px-4 py-3">
            <button
              type="button"
              onClick={() => setShowDone((value) => !value)}
              className="flex items-center gap-1.5 text-[13px] font-semibold text-[#25272b]"
            >
              <ChevronDown className={cn("h-4 w-4 transition-transform", showDone && "rotate-180")} />
              Completed <span className="font-normal text-[#80848d]">({done.length})</span>
            </button>
            {showDone ? (
              <button
                type="button"
                onClick={() => void clearDone()}
                className="text-[12px] font-medium text-[#80848d] hover:text-primary"
              >
                Clear completed
              </button>
            ) : null}
          </div>
          {showDone ? (
            <ul className="divide-y divide-[#f0f1f3] border-t border-[#eceef1]">
              {done.map((todo) => (
                <li key={todo.id} className="flex items-center gap-3 px-4 py-2.5">
                  <CheckButton checked onClick={() => void patch(todo, { done: false })} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[#a0a3a9] line-through">{todo.title}</span>
                  <button
                    type="button"
                    onClick={() => void remove(todo)}
                    aria-label="Delete"
                    className="rounded p-1.5 text-[#a0a3a9] hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function CheckButton({ checked, onClick, label }: { checked: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      aria-label={label ?? (checked ? "Mark as not done" : "Mark as done")}
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
        checked ? "border-emerald-500 bg-emerald-500 text-white" : "border-[#cfd2d8] hover:border-emerald-500",
      )}
    >
      {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </button>
  )
}

function TodoRow({
  todo,
  today,
  expanded,
  onToggleExpand,
  onPatch,
  onDelete,
}: {
  todo: StaffTodo
  today: string
  expanded: boolean
  onToggleExpand: () => void
  onPatch: (changes: Parameters<typeof updateTodo>[1]) => void
  onDelete: () => void
}) {
  const [titleDraft, setTitleDraft] = useState(todo.title)
  const [notesDraft, setNotesDraft] = useState(todo.notes)
  const state = dueState(todo.due_date, today)

  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <CheckButton checked={false} onClick={() => onPatch({ done: true })} />
        <button type="button" onClick={onToggleExpand} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[13px] text-[#25272b]">{todo.title}</span>
          {todo.notes && !expanded ? (
            <span className="block truncate text-[11px] text-[#80848d]">{todo.notes}</span>
          ) : null}
        </button>
        {todo.due_date ? (
          <span className={cn("shrink-0 rounded px-2 py-0.5 text-[11px] font-medium", DUE_STYLES[state] || DUE_STYLES.later)}>
            {dueLabel(todo.due_date, state)}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onToggleExpand}
          aria-label={expanded ? "Close details" : "Open details"}
          className="rounded p-1 text-[#a0a3a9] hover:bg-slate-100"
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
        </button>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-2 pl-8">
          <input
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => titleDraft.trim() && titleDraft !== todo.title && onPatch({ title: titleDraft })}
            maxLength={300}
            aria-label="Title"
            className="h-9 w-full rounded-md border border-[#e5e7eb] px-3 text-[13px] outline-none focus:border-primary/40"
          />
          <textarea
            value={notesDraft}
            onChange={(event) => setNotesDraft(event.target.value)}
            onBlur={() => notesDraft !== todo.notes && onPatch({ notes: notesDraft })}
            placeholder="Notes (optional)"
            rows={2}
            maxLength={4000}
            className="w-full rounded-md border border-[#e5e7eb] px-3 py-2 text-[12px] outline-none placeholder:text-[#a0a3a9] focus:border-primary/40"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[12px] text-[#5f636b]">
              <CalendarDays className="h-3.5 w-3.5" />
              <input
                type="date"
                value={todo.due_date ?? ""}
                onChange={(event) => onPatch({ dueDate: event.target.value || null })}
                className="h-8 rounded-md border border-[#e5e7eb] px-2 text-[12px] outline-none focus:border-primary/40"
              />
            </label>
            {todo.due_date ? (
              <button
                type="button"
                onClick={() => onPatch({ dueDate: null })}
                className="text-[12px] text-[#80848d] hover:text-primary"
              >
                Remove date
              </button>
            ) : null}
            <button
              type="button"
              onClick={onDelete}
              className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-[12px] text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
