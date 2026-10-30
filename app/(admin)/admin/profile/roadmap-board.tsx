"use client"

import { useId, useMemo, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  Lightbulb,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  ROADMAP_AREAS,
  ROADMAP_AREA_LABELS,
  ROADMAP_STATUSES,
  ROADMAP_STATUS_LABELS,
  dueState,
  groupTasksByPhase,
  roadmapProgress,
  type RoadmapArea,
  type RoadmapProject,
  type RoadmapStatus,
  type RoadmapTask,
} from "@/lib/admin/personal-space"
import {
  addRoadmapProject,
  addRoadmapTask,
  deleteRoadmapProject,
  deleteRoadmapTask,
  reorderRoadmapProjects,
  updateRoadmapProject,
  updateRoadmapTask,
} from "./actions"
import { CheckButton } from "./todo-list"
import { formatDueDate, useToday } from "./use-today"

const STATUS_STYLES: Record<RoadmapStatus, { pill: string; bar: string; dot: string }> = {
  in_progress: { pill: "bg-blue-50 text-blue-700 border-blue-200", bar: "bg-blue-500", dot: "bg-blue-500" },
  planned: { pill: "bg-slate-50 text-slate-700 border-slate-200", bar: "bg-slate-400", dot: "bg-slate-400" },
  blocked: { pill: "bg-red-50 text-red-700 border-red-200", bar: "bg-red-500", dot: "bg-red-500" },
  idea: { pill: "bg-violet-50 text-violet-700 border-violet-200", bar: "bg-violet-400", dot: "bg-violet-400" },
  done: { pill: "bg-emerald-50 text-emerald-700 border-emerald-200", bar: "bg-emerald-500", dot: "bg-emerald-500" },
}

type StatusFilter = RoadmapStatus | "all" | "open"

const inputClass =
  "w-full rounded-md border border-[#e5e7eb] bg-white px-3 text-[13px] outline-none placeholder:text-[#a0a3a9] focus:border-primary/40"

export function RoadmapBoard({ initialProjects }: { initialProjects: RoadmapProject[] }) {
  const today = useToday()
  const [projects, setProjects] = useState(initialProjects)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open")
  const [areaFilter, setAreaFilter] = useState<RoadmapArea | "all">("all")
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)

  const counts = useMemo(() => {
    const result: Record<RoadmapStatus, number> = { in_progress: 0, planned: 0, blocked: 0, idea: 0, done: 0 }
    for (const project of projects) result[project.status] += 1
    return result
  }, [projects])

  const allTasks = projects.flatMap((project) => project.tasks)
  const overall = roadmapProgress(allTasks)

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return projects.filter((project) => {
      if (statusFilter === "open" && project.status === "done") return false
      if (statusFilter !== "all" && statusFilter !== "open" && project.status !== statusFilter) return false
      if (areaFilter !== "all" && project.area !== areaFilter) return false
      if (!needle) return true
      return (
        project.title.toLowerCase().includes(needle) ||
        project.summary.toLowerCase().includes(needle) ||
        project.tasks.some((task) => task.title.toLowerCase().includes(needle))
      )
    })
  }, [projects, statusFilter, areaFilter, query])

  const usedAreas = ROADMAP_AREAS.filter((area) => projects.some((project) => project.area === area))
  const allExpanded = visible.length > 0 && visible.every((project) => expanded.has(project.id))

  function setProject(id: string, update: (project: RoadmapProject) => RoadmapProject) {
    setProjects((list) => list.map((project) => (project.id === id ? update(project) : project)))
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function patchProject(project: RoadmapProject, changes: Parameters<typeof updateRoadmapProject>[1]) {
    setProject(project.id, (current) => ({
      ...current,
      ...(changes.title !== undefined ? { title: changes.title.trim() } : {}),
      ...(changes.summary !== undefined ? { summary: changes.summary.trim() } : {}),
      ...(changes.area !== undefined ? { area: changes.area as RoadmapArea } : {}),
      ...(changes.status !== undefined ? { status: changes.status as RoadmapStatus } : {}),
      ...(changes.dueDate !== undefined ? { due_date: changes.dueDate || null } : {}),
    }))
    const result = await updateRoadmapProject(project.id, changes)
    if (!result.ok) {
      setProject(project.id, () => project)
      toast.error(result.message)
      return false
    }
    return true
  }

  async function removeProject(project: RoadmapProject) {
    const taskNote = project.tasks.length ? ` and its ${project.tasks.length} subtasks` : ""
    if (!window.confirm(`Delete "${project.title}"${taskNote}? This cannot be undone.`)) return
    const previous = projects
    setProjects((list) => list.filter((item) => item.id !== project.id))
    const result = await deleteRoadmapProject(project.id)
    if (!result.ok) {
      setProjects(previous)
      toast.error(result.message)
    }
  }

  async function moveProject(project: RoadmapProject, direction: -1 | 1) {
    const visibleIndex = visible.findIndex((item) => item.id === project.id)
    const neighbour = visible[visibleIndex + direction]
    if (!neighbour) return
    const previous = projects
    const next = [...projects]
    const from = next.findIndex((item) => item.id === project.id)
    const to = next.findIndex((item) => item.id === neighbour.id)
    next[from] = neighbour
    next[to] = project
    setProjects(next)
    const result = await reorderRoadmapProjects(next.map((item) => item.id))
    if (!result.ok) {
      setProjects(previous)
      toast.error(result.message)
    }
  }

  async function patchTask(project: RoadmapProject, task: RoadmapTask, changes: Parameters<typeof updateRoadmapTask>[1]) {
    const optimistic: RoadmapTask = {
      ...task,
      ...(changes.title !== undefined ? { title: changes.title.trim() } : {}),
      ...(changes.phase !== undefined ? { phase: changes.phase.trim() } : {}),
      ...(changes.done !== undefined ? { done_at: changes.done ? new Date().toISOString() : null } : {}),
      ...(changes.dueDate !== undefined ? { due_date: changes.dueDate || null } : {}),
    }
    setProject(project.id, (current) => ({
      ...current,
      tasks: current.tasks.map((item) => (item.id === task.id ? optimistic : item)),
    }))
    const result = await updateRoadmapTask(task.id, changes)
    if (!result.ok) {
      setProject(project.id, (current) => ({
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? task : item)),
      }))
      toast.error(result.message)
    }
  }

  async function removeTask(project: RoadmapProject, task: RoadmapTask) {
    setProject(project.id, (current) => ({ ...current, tasks: current.tasks.filter((item) => item.id !== task.id) }))
    const result = await deleteRoadmapTask(task.id)
    if (!result.ok) {
      setProject(project.id, (current) => ({ ...current, tasks: [...current.tasks, task] }))
      toast.error(result.message)
    }
  }

  async function addTask(project: RoadmapProject, title: string, phase: string) {
    const result = await addRoadmapTask(project.id, { title, phase })
    if (!result.ok) {
      toast.error(result.message)
      return false
    }
    setProject(project.id, (current) => ({ ...current, tasks: [...current.tasks, result.data] }))
    return true
  }

  const filterChips: Array<{ id: StatusFilter; label: string; count: number }> = [
    { id: "open", label: "Active", count: projects.length - counts.done },
    { id: "in_progress", label: "In progress", count: counts.in_progress },
    { id: "planned", label: "Planned", count: counts.planned },
    { id: "blocked", label: "Blocked", count: counts.blocked },
    { id: "idea", label: "Ideas", count: counts.idea },
    { id: "done", label: "Done", count: counts.done },
    { id: "all", label: "All", count: projects.length },
  ]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryTile label="In progress" value={counts.in_progress} tone="bg-blue-500" />
        <SummaryTile label="Planned" value={counts.planned} tone="bg-slate-400" />
        <SummaryTile label="Ideas to review" value={counts.idea} tone="bg-violet-400" />
        <div className="rounded-lg border border-[#eceef1] bg-white px-4 py-3">
          <p className="text-[11px] font-medium text-[#80848d]">Subtasks done</p>
          <p className="mt-0.5 text-[18px] font-semibold tabular-nums text-[#202124]">
            {overall.done}
            <span className="text-[13px] font-normal text-[#a0a3a9]"> / {overall.total}</span>
          </p>
          <ProgressBar percent={overall.percent} className="mt-2" />
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-[#eceef1] bg-white p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects and subtasks"
              className={cn(inputClass, "h-9 pl-9")}
            />
          </div>
          <select
            value={areaFilter}
            onChange={(event) => setAreaFilter(event.target.value as RoadmapArea | "all")}
            className={cn(inputClass, "h-9 sm:w-[180px]")}
            aria-label="Filter by area"
          >
            <option value="all">All areas</option>
            {usedAreas.map((area) => (
              <option key={area} value={area}>
                {ROADMAP_AREA_LABELS[area]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-semibold text-white hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New project
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {filterChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setStatusFilter(chip.id)}
              className={cn(
                "h-7 rounded-full border px-3 text-[11px] font-medium transition-colors",
                statusFilter === chip.id
                  ? "border-primary bg-red-50 text-primary"
                  : "border-[#e5e7eb] bg-white text-[#5f636b] hover:bg-slate-50",
              )}
            >
              {chip.label} <span className="tabular-nums opacity-70">{chip.count}</span>
            </button>
          ))}
          {visible.length ? (
            <button
              type="button"
              onClick={() =>
                setExpanded(allExpanded ? new Set() : new Set(visible.map((project) => project.id)))
              }
              className="ml-auto text-[11px] font-medium text-[#80848d] hover:text-primary"
            >
              {allExpanded ? "Collapse all" : "Expand all"}
            </button>
          ) : null}
        </div>
      </div>

      {creating ? (
        <NewProjectForm
          onCancel={() => setCreating(false)}
          onCreated={(project) => {
            setProjects((list) => [project, ...list])
            setExpanded((current) => new Set(current).add(project.id))
            setCreating(false)
            if (statusFilter !== "all" && statusFilter !== "open" && statusFilter !== project.status) setStatusFilter("open")
          }}
        />
      ) : null}

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#dfe1e5] bg-white px-4 py-10 text-center text-[13px] text-[#80848d]">
          {projects.length ? "No projects match these filters." : "No projects yet. Add your first one with New project."}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((project, index) => (
            <ProjectCard
              key={project.id}
              project={project}
              today={today}
              expanded={expanded.has(project.id)}
              isFirst={index === 0}
              isLast={index === visible.length - 1}
              onToggle={() => toggleExpanded(project.id)}
              onPatch={(changes) => patchProject(project, changes)}
              onDelete={() => void removeProject(project)}
              onMove={(direction) => void moveProject(project, direction)}
              onPatchTask={(task, changes) => void patchTask(project, task, changes)}
              onDeleteTask={(task) => void removeTask(project, task)}
              onAddTask={(title, phase) => addTask(project, title, phase)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-[#eceef1] bg-white px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-[#80848d]">
        <span className={cn("h-2 w-2 rounded-full", tone)} />
        {label}
      </p>
      <p className="mt-0.5 text-[18px] font-semibold tabular-nums text-[#202124]">{value}</p>
    </div>
  )
}

function ProgressBar({ percent, className, tone = "bg-emerald-500" }: { percent: number; className?: string; tone?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-[#eef0f3]", className)}>
      <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${percent}%` }} />
    </div>
  )
}

function DueBadge({ date, today }: { date: string | null; today: string }) {
  if (!date) return null
  const state = dueState(date, today, 14)
  const styles = {
    none: "",
    overdue: "bg-red-50 text-red-700",
    today: "bg-amber-50 text-amber-700",
    soon: "bg-amber-50 text-amber-700",
    later: "bg-slate-100 text-slate-600",
  }[state]
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium", styles)}>
      <CalendarDays className="h-3 w-3" />
      {state === "overdue" ? "Overdue · " : state === "today" ? "Due today · " : "Due "}
      {formatDueDate(date)}
    </span>
  )
}

function ProjectCard({
  project,
  today,
  expanded,
  isFirst,
  isLast,
  onToggle,
  onPatch,
  onDelete,
  onMove,
  onPatchTask,
  onDeleteTask,
  onAddTask,
}: {
  project: RoadmapProject
  today: string
  expanded: boolean
  isFirst: boolean
  isLast: boolean
  onToggle: () => void
  onPatch: (changes: Parameters<typeof updateRoadmapProject>[1]) => Promise<boolean>
  onDelete: () => void
  onMove: (direction: -1 | 1) => void
  onPatchTask: (task: RoadmapTask, changes: Parameters<typeof updateRoadmapTask>[1]) => void
  onDeleteTask: (task: RoadmapTask) => void
  onAddTask: (title: string, phase: string) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const progress = roadmapProgress(project.tasks)
  const style = STATUS_STYLES[project.status]
  const groups = groupTasksByPhase(project.tasks)
  const phases = groups.map((group) => group.phase).filter(Boolean)

  return (
    <article className="relative overflow-hidden rounded-lg border border-[#eceef1] bg-white">
      <span className={cn("absolute inset-y-0 left-0 w-1", style.bar)} aria-hidden />

      <div className="flex flex-col gap-3 py-3 pl-5 pr-3 sm:flex-row sm:items-start">
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left" aria-expanded={expanded}>
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-[14px] font-semibold leading-snug text-[#18191c]">{project.title}</h3>
            <span className="rounded bg-[#f3f4f6] px-1.5 py-0.5 text-[10px] font-medium text-[#5f636b]">
              {ROADMAP_AREA_LABELS[project.area]}
            </span>
            {project.suggested ? (
              <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                <Lightbulb className="h-3 w-3" />
                Suggested
              </span>
            ) : null}
          </div>
          {project.summary ? (
            <p className={cn("mt-1 text-[12px] leading-relaxed text-[#5f636b]", !expanded && "line-clamp-2")}>
              {project.summary}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {progress.total ? (
              <span className="flex items-center gap-2 text-[11px] text-[#80848d]">
                <ProgressBar percent={progress.percent} className="w-24" />
                <span className="tabular-nums">
                  {progress.done} of {progress.total} done
                </span>
              </span>
            ) : (
              <span className="text-[11px] text-[#a0a3a9]">No subtasks yet</span>
            )}
            <DueBadge date={project.due_date} today={today} />
          </div>
        </button>

        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
          <select
            value={project.status}
            onChange={(event) => void onPatch({ status: event.target.value })}
            aria-label="Status"
            className={cn("h-8 rounded-md border px-2 text-[12px] font-medium outline-none", style.pill)}
          >
            {ROADMAP_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ROADMAP_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[11px] text-[#80848d]">
            <span>Deadline</span>
            <input
              type="date"
              value={project.due_date ?? ""}
              onChange={(event) => void onPatch({ dueDate: event.target.value || null })}
              className="h-8 rounded-md border border-[#e5e7eb] px-2 text-[12px] text-[#25272b] outline-none focus:border-primary/40"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? "Hide subtasks" : "Show subtasks"}
          className="hidden rounded p-1 text-[#a0a3a9] hover:bg-slate-100 sm:block"
        >
          <ChevronDown className={cn("h-5 w-5 transition-transform", expanded && "rotate-180")} />
        </button>
      </div>

      {expanded ? (
        <div className="border-t border-[#f0f1f3] bg-[#fafbfc] py-3 pl-5 pr-3">
          {editing ? (
            <EditProjectForm
              project={project}
              onCancel={() => setEditing(false)}
              onSave={async (changes) => {
                if (await onPatch(changes)) setEditing(false)
              }}
            />
          ) : (
            <>
              {groups.length ? (
                <div className="space-y-3">
                  {groups.map((group) => {
                    const groupDone = group.tasks.filter((task) => task.done_at).length
                    return (
                      <section key={group.phase || "_"}>
                        {group.phase ? (
                          <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[#80848d]">
                            {group.phase}
                            <span className="font-normal normal-case tracking-normal text-[#a0a3a9]">
                              {groupDone}/{group.tasks.length}
                            </span>
                          </p>
                        ) : null}
                        <ul className="space-y-0.5">
                          {group.tasks.map((task) => (
                            <TaskRow
                              key={task.id}
                              task={task}
                              today={today}
                              onPatch={(changes) => onPatchTask(task, changes)}
                              onDelete={() => onDeleteTask(task)}
                            />
                          ))}
                        </ul>
                      </section>
                    )
                  })}
                </div>
              ) : (
                <p className="text-[12px] text-[#80848d]">Break this project into steps below.</p>
              )}

              <AddTaskForm phases={phases} onAdd={onAddTask} />

              <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-[#eceef1] pt-3">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[12px] text-[#5f636b] hover:bg-white"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit project
                </button>
                <button
                  type="button"
                  disabled={isFirst}
                  onClick={() => onMove(-1)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[12px] text-[#5f636b] hover:bg-white disabled:opacity-40"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                  Move up
                </button>
                <button
                  type="button"
                  disabled={isLast}
                  onClick={() => onMove(1)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[12px] text-[#5f636b] hover:bg-white disabled:opacity-40"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  Move down
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-[12px] text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete project
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </article>
  )
}

function TaskRow({
  task,
  today,
  onPatch,
  onDelete,
}: {
  task: RoadmapTask
  today: string
  onPatch: (changes: Parameters<typeof updateRoadmapTask>[1]) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.title)
  const done = Boolean(task.done_at)

  function save() {
    setEditing(false)
    if (draft.trim() && draft.trim() !== task.title) onPatch({ title: draft })
    else setDraft(task.title)
  }

  return (
    <li className="group flex items-start gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-white">
      <span className="pt-0.5">
        <CheckButton checked={done} onClick={() => onPatch({ done: !done })} />
      </span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Enter") save()
            if (event.key === "Escape") {
              setDraft(task.title)
              setEditing(false)
            }
          }}
          maxLength={500}
          className={cn(inputClass, "h-8 flex-1")}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Click to edit"
          className={cn(
            "min-w-0 flex-1 text-left text-[13px] leading-snug",
            done ? "text-[#a0a3a9] line-through" : "text-[#25272b]",
          )}
        >
          {task.title}
        </button>
      )}
      {task.due_date && !done ? <DueBadge date={task.due_date} today={today} /> : null}
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete subtask"
        className="rounded p-1 text-[#c3c6cc] opacity-100 hover:bg-red-50 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  )
}

function AddTaskForm({ phases, onAdd }: { phases: string[]; onAdd: (title: string, phase: string) => Promise<boolean> }) {
  const [title, setTitle] = useState("")
  const [phase, setPhase] = useState(phases[phases.length - 1] ?? "")
  const [saving, setSaving] = useState(false)
  const listId = useId()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)
    const ok = await onAdd(title, phase)
    setSaving(false)
    if (ok) setTitle("")
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-3 flex flex-col gap-2 sm:flex-row">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Add a subtask and press Enter"
        maxLength={500}
        className={cn(inputClass, "h-9 flex-1")}
      />
      <input
        value={phase}
        onChange={(event) => setPhase(event.target.value)}
        list={listId}
        placeholder="Group (optional)"
        maxLength={80}
        className={cn(inputClass, "h-9 sm:w-[170px]")}
        aria-label="Group"
      />
      <datalist id={listId}>
        {phases.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
      <button
        type="submit"
        disabled={saving || !title.trim()}
        className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-[#e5e7eb] bg-white px-3 text-[12px] font-semibold text-[#25272b] hover:border-primary/40 disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        Add
      </button>
    </form>
  )
}

function ProjectFields({
  title,
  summary,
  area,
  onTitle,
  onSummary,
  onArea,
}: {
  title: string
  summary: string
  area: RoadmapArea
  onTitle: (value: string) => void
  onSummary: (value: string) => void
  onArea: (value: RoadmapArea) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          autoFocus
          value={title}
          onChange={(event) => onTitle(event.target.value)}
          placeholder="Project name"
          maxLength={200}
          className={cn(inputClass, "h-9 flex-1 font-medium")}
        />
        <select
          value={area}
          onChange={(event) => onArea(event.target.value as RoadmapArea)}
          className={cn(inputClass, "h-9 sm:w-[180px]")}
          aria-label="Area"
        >
          {ROADMAP_AREAS.map((item) => (
            <option key={item} value={item}>
              {ROADMAP_AREA_LABELS[item]}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={summary}
        onChange={(event) => onSummary(event.target.value)}
        placeholder="The overall goal: what this project should achieve"
        rows={3}
        maxLength={6000}
        className={cn(inputClass, "py-2 text-[12px] leading-relaxed")}
      />
    </div>
  )
}

function NewProjectForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  onCreated: (project: RoadmapProject) => void
}) {
  const [title, setTitle] = useState("")
  const [summary, setSummary] = useState("")
  const [area, setArea] = useState<RoadmapArea>("crm")
  const [saving, setSaving] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)
    const result = await addRoadmapProject({ title, summary, area })
    setSaving(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    onCreated(result.data)
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="space-y-3 rounded-lg border border-primary/30 bg-white p-4 ring-1 ring-primary/10"
    >
      <p className="text-[13px] font-semibold text-[#25272b]">New project</p>
      <ProjectFields
        title={title}
        summary={summary}
        area={area}
        onTitle={setTitle}
        onSummary={setSummary}
        onArea={setArea}
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 rounded-md border border-[#e5e7eb] px-4 text-[12px] font-medium text-[#5f636b] hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Add project
        </button>
      </div>
    </form>
  )
}

function EditProjectForm({
  project,
  onCancel,
  onSave,
}: {
  project: RoadmapProject
  onCancel: () => void
  onSave: (changes: { title: string; summary: string; area: string }) => Promise<void>
}) {
  const [title, setTitle] = useState(project.title)
  const [summary, setSummary] = useState(project.summary)
  const [area, setArea] = useState<RoadmapArea>(project.area)
  const [saving, setSaving] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)
    await onSave({ title, summary, area })
    setSaving(false)
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-3">
      <ProjectFields
        title={title}
        summary={summary}
        area={area}
        onTitle={setTitle}
        onSummary={setSummary}
        onArea={setArea}
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 rounded-md border border-[#e5e7eb] bg-white px-4 text-[12px] font-medium text-[#5f636b] hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Save
        </button>
      </div>
    </form>
  )
}
