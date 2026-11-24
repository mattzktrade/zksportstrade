/** Staff profile space: private to-do list for everyone, development roadmap for Matt only. */

export const ROADMAP_OWNER_EMAIL = "matt@zk-sports.com"

export function canUseRoadmap(profile: { email?: string | null } | null | undefined): boolean {
  return (profile?.email ?? "").trim().toLowerCase() === ROADMAP_OWNER_EMAIL
}

export type StaffTodo = {
  id: string
  title: string
  notes: string
  due_date: string | null
  done_at: string | null
  position: number
  created_at: string
}

export const ROADMAP_STATUSES = ["in_progress", "planned", "blocked", "idea", "done"] as const
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number]

export const ROADMAP_STATUS_LABELS: Record<RoadmapStatus, string> = {
  in_progress: "In progress",
  planned: "Planned",
  blocked: "Blocked",
  idea: "Idea",
  done: "Done",
}

export const ROADMAP_AREAS = [
  "crm",
  "sales",
  "operations",
  "marketing",
  "ai",
  "data",
  "client",
  "ticketing",
  "website",
  "partners",
  "finance",
  "security",
  "other",
] as const
export type RoadmapArea = (typeof ROADMAP_AREAS)[number]

export const ROADMAP_AREA_LABELS: Record<RoadmapArea, string> = {
  crm: "CRM",
  sales: "Sales",
  operations: "Operations",
  marketing: "Marketing",
  ai: "AI agents",
  data: "Data & knowledge",
  client: "Client experience",
  ticketing: "Ticketing",
  website: "Websites",
  partners: "Partners & APIs",
  finance: "Finance",
  security: "IT & security",
  other: "Other",
}

export function isRoadmapStatus(value: unknown): value is RoadmapStatus {
  return typeof value === "string" && (ROADMAP_STATUSES as readonly string[]).includes(value)
}

export function isRoadmapArea(value: unknown): value is RoadmapArea {
  return typeof value === "string" && (ROADMAP_AREAS as readonly string[]).includes(value)
}

export type RoadmapTask = {
  id: string
  project_id: string
  title: string
  phase: string
  due_date: string | null
  done_at: string | null
  position: number
}

export type RoadmapProject = {
  id: string
  title: string
  summary: string
  area: RoadmapArea
  status: RoadmapStatus
  due_date: string | null
  position: number
  suggested: boolean
  tasks: RoadmapTask[]
}

export function roadmapProgress(tasks: Pick<RoadmapTask, "done_at">[]): { done: number; total: number; percent: number } {
  const total = tasks.length
  const done = tasks.filter((task) => task.done_at).length
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 }
}

/** Subtasks grouped by phase, keeping the order phases first appear in. */
export function groupTasksByPhase<T extends Pick<RoadmapTask, "phase" | "position">>(
  tasks: T[],
): Array<{ phase: string; tasks: T[] }> {
  const groups = new Map<string, T[]>()
  for (const task of [...tasks].sort((a, b) => a.position - b.position)) {
    const key = task.phase.trim()
    const list = groups.get(key)
    if (list) list.push(task)
    else groups.set(key, [task])
  }
  return [...groups.entries()].map(([phase, list]) => ({ phase, tasks: list }))
}

export type DueState = "none" | "overdue" | "today" | "soon" | "later"

/** `date` is a plain `YYYY-MM-DD`; `today` is the viewer's local date in the same format. */
export function dueState(date: string | null, today: string, soonDays = 7): DueState {
  if (!date) return "none"
  if (date < today) return "overdue"
  if (date === today) return "today"
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  return days <= soonDays ? "soon" : "later"
}

export function cleanDate(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) && Number.isFinite(Date.parse(`${trimmed}T00:00:00Z`)) ? trimmed : null
}

export const ROADMAP_SORTS = ["manual", "due_soonest", "due_latest"] as const
export type RoadmapSort = (typeof ROADMAP_SORTS)[number]

export const ROADMAP_SORT_LABELS: Record<RoadmapSort, string> = {
  manual: "Your order",
  due_soonest: "Deadline (soonest first)",
  due_latest: "Deadline (latest first)",
}

export function isRoadmapSort(value: unknown): value is RoadmapSort {
  return typeof value === "string" && (ROADMAP_SORTS as readonly string[]).includes(value)
}

/** Dated projects first by deadline; projects with no deadline stay at the end in their saved order. */
export function sortRoadmapProjects<T extends { due_date: string | null; position: number }>(
  projects: T[],
  sort: RoadmapSort,
): T[] {
  if (sort === "manual") return [...projects]
  const dated = projects.filter((project) => project.due_date)
  const undated = projects.filter((project) => !project.due_date).sort((a, b) => a.position - b.position)
  dated.sort((a, b) => {
    const dateOrder = (a.due_date as string).localeCompare(b.due_date as string)
    if (dateOrder !== 0) return sort === "due_soonest" ? dateOrder : -dateOrder
    return a.position - b.position
  })
  return [...dated, ...undated]
}
