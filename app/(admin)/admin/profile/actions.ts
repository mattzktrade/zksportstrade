"use server"

import { createClient as createStatelessClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { getPortalProfile } from "@/lib/supabase/profile"
import { isCmsStaff } from "@/lib/auth/permissions"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import {
  canUseRoadmap,
  cleanDate,
  isRoadmapArea,
  isRoadmapStatus,
  type RoadmapArea,
  type RoadmapProject,
  type RoadmapStatus,
  type RoadmapTask,
  type StaffTodo,
} from "@/lib/admin/personal-space"

type Result<T = undefined> = { ok: true; data: T } | { ok: false; message: string }

const TODO_COLUMNS = "id, title, notes, due_date, done_at, position, created_at"
const PROJECT_COLUMNS = "id, title, summary, area, status, due_date, position, suggested"
const TASK_COLUMNS = "id, project_id, title, phase, due_date, done_at, position"

function fail<T>(message: string): Result<T> {
  return { ok: false, message }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again."
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

async function staffGate() {
  const profile = await getPortalProfile()
  if (!profile || !isCmsStaff(profile)) return null
  return { profile, supabase: await createClient() }
}

async function roadmapGate() {
  const gate = await staffGate()
  if (!gate || !canUseRoadmap(gate.profile)) return null
  return gate
}

// ---------------------------------------------------------------------------
// To-do list
// ---------------------------------------------------------------------------

export async function addTodo(input: { title: string; dueDate?: string | null }): Promise<Result<StaffTodo>> {
  const gate = await staffGate()
  if (!gate) return fail("Please sign in again.")
  const title = cleanText(input.title, 300)
  if (!title) return fail("Type what needs doing first.")

  try {
    const { data: last } = await gate.supabase
      .from("staff_todos")
      .select("position")
      .eq("profile_id", gate.profile.id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle()
    const { data, error } = await gate.supabase
      .from("staff_todos")
      .insert({
        profile_id: gate.profile.id,
        title,
        due_date: cleanDate(input.dueDate),
        position: (last?.position ?? 0) + 1,
      })
      .select(TODO_COLUMNS)
      .single()
    if (error || !data) throw new Error(error?.message ?? "Could not add the to-do.")
    return { ok: true, data: data as StaffTodo }
  } catch (error) {
    return fail(errorMessage(error))
  }
}

export async function updateTodo(
  id: string,
  patch: { title?: string; notes?: string; dueDate?: string | null; done?: boolean },
): Promise<Result<StaffTodo>> {
  const gate = await staffGate()
  if (!gate) return fail("Please sign in again.")

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.title !== undefined) {
    const title = cleanText(patch.title, 300)
    if (!title) return fail("A to-do needs a title.")
    update.title = title
  }
  if (patch.notes !== undefined) update.notes = cleanText(patch.notes, 4000)
  if (patch.dueDate !== undefined) update.due_date = cleanDate(patch.dueDate)
  if (patch.done !== undefined) update.done_at = patch.done ? new Date().toISOString() : null

  try {
    const { data, error } = await gate.supabase
      .from("staff_todos")
      .update(update)
      .eq("id", id)
      .eq("profile_id", gate.profile.id)
      .select(TODO_COLUMNS)
      .single()
    if (error || !data) throw new Error(error?.message ?? "To-do not found.")
    return { ok: true, data: data as StaffTodo }
  } catch (error) {
    return fail(errorMessage(error))
  }
}

export async function deleteTodo(id: string): Promise<Result> {
  const gate = await staffGate()
  if (!gate) return fail("Please sign in again.")
  const { error } = await gate.supabase.from("staff_todos").delete().eq("id", id).eq("profile_id", gate.profile.id)
  return error ? fail(error.message) : { ok: true, data: undefined }
}

export async function clearCompletedTodos(): Promise<Result> {
  const gate = await staffGate()
  if (!gate) return fail("Please sign in again.")
  const { error } = await gate.supabase
    .from("staff_todos")
    .delete()
    .eq("profile_id", gate.profile.id)
    .not("done_at", "is", null)
  return error ? fail(error.message) : { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// Roadmap (Matt only)
// ---------------------------------------------------------------------------

export async function addRoadmapProject(input: {
  title: string
  summary?: string
  area?: string
  status?: string
}): Promise<Result<RoadmapProject>> {
  const gate = await roadmapGate()
  if (!gate) return fail("The roadmap is only available on Matt's account.")
  const title = cleanText(input.title, 200)
  if (!title) return fail("Give the project a name.")
  const area: RoadmapArea = isRoadmapArea(input.area) ? input.area : "other"
  const status: RoadmapStatus = isRoadmapStatus(input.status) ? input.status : "planned"

  try {
    const { data: first } = await gate.supabase
      .from("roadmap_projects")
      .select("position")
      .eq("owner_profile_id", gate.profile.id)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle()
    const { data, error } = await gate.supabase
      .from("roadmap_projects")
      .insert({
        owner_profile_id: gate.profile.id,
        title,
        summary: cleanText(input.summary, 6000),
        area,
        status,
        position: (first?.position ?? 1) - 1,
      })
      .select(PROJECT_COLUMNS)
      .single()
    if (error || !data) throw new Error(error?.message ?? "Could not add the project.")
    return { ok: true, data: { ...(data as Omit<RoadmapProject, "tasks">), tasks: [] } }
  } catch (error) {
    return fail(errorMessage(error))
  }
}

export async function updateRoadmapProject(
  id: string,
  patch: { title?: string; summary?: string; area?: string; status?: string; dueDate?: string | null },
): Promise<Result> {
  const gate = await roadmapGate()
  if (!gate) return fail("The roadmap is only available on Matt's account.")

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.title !== undefined) {
    const title = cleanText(patch.title, 200)
    if (!title) return fail("A project needs a name.")
    update.title = title
  }
  if (patch.summary !== undefined) update.summary = cleanText(patch.summary, 6000)
  if (patch.area !== undefined) {
    if (!isRoadmapArea(patch.area)) return fail("Choose an area from the list.")
    update.area = patch.area
  }
  if (patch.status !== undefined) {
    if (!isRoadmapStatus(patch.status)) return fail("Choose a status from the list.")
    update.status = patch.status
  }
  if (patch.dueDate !== undefined) update.due_date = cleanDate(patch.dueDate)

  const { error } = await gate.supabase
    .from("roadmap_projects")
    .update(update)
    .eq("id", id)
    .eq("owner_profile_id", gate.profile.id)
  return error ? fail(error.message) : { ok: true, data: undefined }
}

export async function deleteRoadmapProject(id: string): Promise<Result> {
  const gate = await roadmapGate()
  if (!gate) return fail("The roadmap is only available on Matt's account.")
  const { error } = await gate.supabase
    .from("roadmap_projects")
    .delete()
    .eq("id", id)
    .eq("owner_profile_id", gate.profile.id)
  return error ? fail(error.message) : { ok: true, data: undefined }
}

/** Saves the full project order shown on screen. */
export async function reorderRoadmapProjects(orderedIds: string[]): Promise<Result> {
  const gate = await roadmapGate()
  if (!gate) return fail("The roadmap is only available on Matt's account.")
  try {
    const results = await Promise.all(
      orderedIds.slice(0, 500).map((id, index) =>
        gate.supabase
          .from("roadmap_projects")
          .update({ position: index + 1 })
          .eq("id", id)
          .eq("owner_profile_id", gate.profile.id),
      ),
    )
    const failed = results.find((result) => result.error)
    if (failed?.error) throw new Error(failed.error.message)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(errorMessage(error))
  }
}

export async function addRoadmapTask(
  projectId: string,
  input: { title: string; phase?: string },
): Promise<Result<RoadmapTask>> {
  const gate = await roadmapGate()
  if (!gate) return fail("The roadmap is only available on Matt's account.")
  const title = cleanText(input.title, 500)
  if (!title) return fail("Type the subtask first.")

  try {
    const { data: last } = await gate.supabase
      .from("roadmap_tasks")
      .select("position")
      .eq("project_id", projectId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle()
    const { data, error } = await gate.supabase
      .from("roadmap_tasks")
      .insert({
        project_id: projectId,
        owner_profile_id: gate.profile.id,
        title,
        phase: cleanText(input.phase, 80),
        position: (last?.position ?? 0) + 1,
      })
      .select(TASK_COLUMNS)
      .single()
    if (error || !data) throw new Error(error?.message ?? "Could not add the subtask.")
    return { ok: true, data: data as RoadmapTask }
  } catch (error) {
    return fail(errorMessage(error))
  }
}

export async function updateRoadmapTask(
  id: string,
  patch: { title?: string; phase?: string; done?: boolean; dueDate?: string | null },
): Promise<Result<RoadmapTask>> {
  const gate = await roadmapGate()
  if (!gate) return fail("The roadmap is only available on Matt's account.")

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.title !== undefined) {
    const title = cleanText(patch.title, 500)
    if (!title) return fail("A subtask needs a title.")
    update.title = title
  }
  if (patch.phase !== undefined) update.phase = cleanText(patch.phase, 80)
  if (patch.done !== undefined) update.done_at = patch.done ? new Date().toISOString() : null
  if (patch.dueDate !== undefined) update.due_date = cleanDate(patch.dueDate)

  try {
    const { data, error } = await gate.supabase
      .from("roadmap_tasks")
      .update(update)
      .eq("id", id)
      .eq("owner_profile_id", gate.profile.id)
      .select(TASK_COLUMNS)
      .single()
    if (error || !data) throw new Error(error?.message ?? "Subtask not found.")
    return { ok: true, data: data as RoadmapTask }
  } catch (error) {
    return fail(errorMessage(error))
  }
}

export async function deleteRoadmapTask(id: string): Promise<Result> {
  const gate = await roadmapGate()
  if (!gate) return fail("The roadmap is only available on Matt's account.")
  const { error } = await gate.supabase
    .from("roadmap_tasks")
    .delete()
    .eq("id", id)
    .eq("owner_profile_id", gate.profile.id)
  return error ? fail(error.message) : { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

export async function changeOwnPassword(input: { currentPassword: string; newPassword: string }): Promise<Result> {
  const gate = await staffGate()
  if (!gate) return fail("Please sign in again.")
  if (!gate.profile.email) return fail("Your login has no email address. Ask an admin to reset your password.")

  if (!checkRateLimit(`staff-password-change:${gate.profile.id}`, 5, 15 * 60_000)) {
    return fail("Too many attempts. Wait 15 minutes and try again.")
  }
  if (!input.currentPassword) return fail("Enter your current password.")
  if (input.newPassword.length < 8) return fail("New password must be at least 8 characters.")
  if (input.newPassword === input.currentPassword) return fail("Choose a password you are not already using.")

  // Separate client with no cookies, so checking the current password cannot touch this browser session.
  const verifier = createStatelessClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { error: verifyError } = await verifier.auth.signInWithPassword({
    email: gate.profile.email,
    password: input.currentPassword,
  })
  if (verifyError) return fail("Your current password is not right.")
  await verifier.auth.signOut({ scope: "local" })

  const { error } = await gate.supabase.auth.updateUser({ password: input.newPassword })
  if (error) return fail(error.message)
  return { ok: true, data: undefined }
}
