import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import {
  canUseRoadmap,
  cleanDate,
  dueState,
  groupTasksByPhase,
  isRoadmapArea,
  isRoadmapStatus,
  roadmapProgress,
} from "../lib/admin/personal-space"

test("roadmap is only for Matt's login", () => {
  assert.equal(canUseRoadmap({ email: "matt@zk-sports.com" }), true)
  assert.equal(canUseRoadmap({ email: " Matt@ZK-Sports.com " }), true)
  assert.equal(canUseRoadmap({ email: "oliver@zk-sports.com" }), false)
  assert.equal(canUseRoadmap({ email: "matt@zk-sports.com.evil.test" }), false)
  assert.equal(canUseRoadmap(null), false)
})

test("progress counts done subtasks", () => {
  assert.deepEqual(roadmapProgress([]), { done: 0, total: 0, percent: 0 })
  assert.deepEqual(roadmapProgress([{ done_at: "2026-10-30T10:00:00Z" }, { done_at: null }, { done_at: null }]), {
    done: 1,
    total: 3,
    percent: 33,
  })
})

test("subtasks group by phase in first-seen order", () => {
  const groups = groupTasksByPhase([
    { phase: "Build", position: 3 },
    { phase: "Plan", position: 1 },
    { phase: "Build", position: 2 },
    { phase: "", position: 4 },
  ])
  assert.deepEqual(
    groups.map((group) => [group.phase, group.tasks.map((task) => task.position)]),
    [
      ["Plan", [1]],
      ["Build", [2, 3]],
      ["", [4]],
    ],
  )
})

test("due state compares plain dates", () => {
  assert.equal(dueState(null, "2026-10-30"), "none")
  assert.equal(dueState("2026-10-29", "2026-10-30"), "overdue")
  assert.equal(dueState("2026-10-30", "2026-10-30"), "today")
  assert.equal(dueState("2026-11-05", "2026-10-30"), "soon")
  assert.equal(dueState("2026-12-25", "2026-10-30"), "later")
})

test("cleanDate only keeps real YYYY-MM-DD dates", () => {
  assert.equal(cleanDate("2026-11-02"), "2026-11-02")
  assert.equal(cleanDate(" 2026-11-02 "), "2026-11-02")
  assert.equal(cleanDate("02/11/2026"), null)
  assert.equal(cleanDate(""), null)
  assert.equal(cleanDate(null), null)
})

test("seeded roadmap uses valid areas and statuses and leaves deadlines blank", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20261030110000_staff_todos_and_roadmap.sql"),
    "utf8",
  )
  const json = sql.split("$json$")[1]
  const seed = JSON.parse(json) as Array<{
    title: string
    area: string
    status: string
    due_date?: string
    tasks: Array<{ title: string; phase: string }>
  }>
  assert.ok(seed.length >= 17)
  for (const project of seed) {
    assert.ok(isRoadmapArea(project.area), `${project.title}: area ${project.area}`)
    assert.ok(isRoadmapStatus(project.status), `${project.title}: status ${project.status}`)
    assert.equal(project.due_date, undefined)
    assert.ok(project.title.length <= 200)
    assert.ok(project.tasks.length > 0, `${project.title} has subtasks`)
    for (const task of project.tasks) {
      assert.ok(task.title.length <= 500)
      assert.ok(task.phase.length <= 80)
    }
  }
})
