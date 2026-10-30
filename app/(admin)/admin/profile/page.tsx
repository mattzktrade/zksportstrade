import { requireAdmin } from "@/lib/admin/require-admin"
import { createClient } from "@/lib/supabase/server"
import {
  canUseRoadmap,
  type RoadmapProject,
  type RoadmapTask,
  type StaffTodo,
} from "@/lib/admin/personal-space"
import { ProfileClient, type ProfileTab } from "./profile-client"

export const dynamic = "force-dynamic"

export default async function AdminProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const profile = await requireAdmin()
  const roadmapAllowed = canUseRoadmap(profile)
  const { tab } = await searchParams
  const supabase = await createClient()

  const [todosResult, projectsResult, tasksResult] = await Promise.all([
    supabase
      .from("staff_todos")
      .select("id, title, notes, due_date, done_at, position, created_at")
      .eq("profile_id", profile.id)
      .order("position", { ascending: true }),
    roadmapAllowed
      ? supabase
          .from("roadmap_projects")
          .select("id, title, summary, area, status, due_date, position, suggested")
          .eq("owner_profile_id", profile.id)
          .order("position", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    roadmapAllowed
      ? supabase
          .from("roadmap_tasks")
          .select("id, project_id, title, phase, due_date, done_at, position")
          .eq("owner_profile_id", profile.id)
          .order("position", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ])

  const tasksByProject = new Map<string, RoadmapTask[]>()
  for (const task of (tasksResult.data ?? []) as RoadmapTask[]) {
    const list = tasksByProject.get(task.project_id)
    if (list) list.push(task)
    else tasksByProject.set(task.project_id, [task])
  }
  const projects: RoadmapProject[] = ((projectsResult.data ?? []) as Omit<RoadmapProject, "tasks">[]).map((project) => ({
    ...project,
    tasks: tasksByProject.get(project.id) ?? [],
  }))

  const loadError = todosResult.error ?? projectsResult.error ?? tasksResult.error
  const initialTab: ProfileTab =
    tab === "password" ? "password" : tab === "roadmap" && roadmapAllowed ? "roadmap" : "todos"

  return (
    <ProfileClient
      name={profile.full_name?.trim() || profile.email}
      email={profile.email}
      role={profile.role}
      initialTab={initialTab}
      roadmapAllowed={roadmapAllowed}
      initialTodos={(todosResult.data ?? []) as StaffTodo[]}
      initialProjects={projects}
      loadError={loadError ? "Could not load your list. If this is the first time, the database update may not be applied yet." : null}
    />
  )
}
