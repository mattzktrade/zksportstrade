import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import {
  decideSessionGate,
  hasSupabaseAuthCookie,
  isPublicPath,
  isRouterPrefetch,
  isSessionlessApiPath,
  withTimeout,
} from "../lib/supabase/session-guard"

describe("session-guard paths", () => {
  it("treats cron and webhooks as sessionless", () => {
    assert.equal(isSessionlessApiPath("/api/cron/integration-outbox"), true)
    assert.equal(isSessionlessApiPath("/api/webhooks/xero"), true)
    assert.equal(isSessionlessApiPath("/api/integrations/xero/connect"), false)
    assert.equal(isSessionlessApiPath("/admin/catalog/spain-test"), false)
  })

  it("keeps login, auth callbacks, and booking sign links public", () => {
    assert.equal(isPublicPath("/login"), true)
    assert.equal(isPublicPath("/signup"), true)
    assert.equal(isPublicPath("/auth/callback"), true)
    assert.equal(isPublicPath("/reset-password"), true)
    assert.equal(isPublicPath("/sign/booking/abc"), true)
    assert.equal(isPublicPath("/api/booking-forms/token"), true)
    assert.equal(isPublicPath("/admin/catalog/spain-test"), false)
    assert.equal(isPublicPath("/"), false)
  })

  it("detects supabase auth cookies including chunked tokens", () => {
    assert.equal(hasSupabaseAuthCookie(["sb-abc-auth-token"]), true)
    assert.equal(hasSupabaseAuthCookie(["sb-abc-auth-token.0"]), true)
    assert.equal(hasSupabaseAuthCookie(["sb-abc-auth-token.1"]), true)
    assert.equal(hasSupabaseAuthCookie(["theme", "sidebar"]), false)
  })

  it("detects Next.js router prefetch headers", () => {
    assert.equal(isRouterPrefetch({ get: (name) => (name === "next-router-prefetch" ? "1" : null) }), true)
    assert.equal(isRouterPrefetch({ get: (name) => (name === "purpose" ? "prefetch" : null) }), true)
    assert.equal(isRouterPrefetch({ get: (name) => (name === "x-middleware-prefetch" ? "1" : null) }), true)
    assert.equal(isRouterPrefetch({ get: () => null }), false)
  })
})

describe("decideSessionGate", () => {
  it("sends anonymous users on protected routes to login", () => {
    assert.deepEqual(decideSessionGate({ path: "/admin/catalog/spain-test", userId: null, profile: null, profileKnown: true }), {
      type: "redirect",
      pathname: "/login",
      search: { redirect: "/admin/catalog/spain-test" },
    })
    assert.deepEqual(decideSessionGate({ path: "/login", userId: null, profile: null, profileKnown: true }), {
      type: "next",
    })
  })

  it("lets a verified session through when the profile lookup timed out", () => {
    assert.deepEqual(
      decideSessionGate({
        path: "/admin/catalog/spain-test",
        userId: "user-1",
        profile: null,
        profileKnown: false,
      }),
      { type: "next" },
    )
  })

  it("clears a session when the auth user has no profile", () => {
    assert.deepEqual(decideSessionGate({ path: "/admin", userId: "user-1", profile: null, profileKnown: true }), {
      type: "clear_session",
      then: { pathname: "/login", search: { error: "no_profile" } },
    })
    assert.deepEqual(decideSessionGate({ path: "/login", userId: "user-1", profile: null, profileKnown: true }), {
      type: "clear_session",
      then: "next",
    })
    assert.deepEqual(decideSessionGate({ path: "/auth/callback", userId: "user-1", profile: null, profileKnown: true }), {
      type: "next",
    })
  })

  it("keeps agents out of admin and CMS staff in", () => {
    assert.deepEqual(
      decideSessionGate({
        path: "/admin/catalog/spain-test",
        userId: "user-1",
        profile: { role: "agent", approval_status: "approved" },
        profileKnown: true,
      }),
      { type: "redirect", pathname: "/" },
    )
    assert.deepEqual(
      decideSessionGate({
        path: "/admin/catalog/spain-test",
        userId: "user-1",
        profile: { role: "admin", approval_status: "approved" },
        profileKnown: true,
      }),
      { type: "next" },
    )
    assert.deepEqual(
      decideSessionGate({
        path: "/admin/catalog/spain-test",
        userId: "user-1",
        profile: { role: "sales", approval_status: "approved" },
        profileKnown: true,
      }),
      { type: "next" },
    )
  })

  it("routes pending and rejected accounts the same way as before", () => {
    assert.deepEqual(
      decideSessionGate({
        path: "/",
        userId: "user-1",
        profile: { role: "agent", approval_status: "pending" },
        profileKnown: true,
      }),
      { type: "redirect", pathname: "/pending-approval" },
    )
    assert.deepEqual(
      decideSessionGate({
        path: "/login",
        userId: "user-1",
        profile: { role: "agent", approval_status: "pending" },
        profileKnown: true,
      }),
      { type: "redirect", pathname: "/pending-approval" },
    )
    assert.deepEqual(
      decideSessionGate({
        path: "/pending-approval",
        userId: "user-1",
        profile: { role: "agent", approval_status: "pending" },
        profileKnown: true,
      }),
      { type: "next" },
    )
    assert.deepEqual(
      decideSessionGate({
        path: "/",
        userId: "user-1",
        profile: { role: "agent", approval_status: "rejected" },
        profileKnown: true,
      }),
      { type: "redirect", pathname: "/login", search: { error: "account_rejected" } },
    )
  })

  it("sends approved users away from auth-only pages", () => {
    assert.deepEqual(
      decideSessionGate({
        path: "/login",
        userId: "user-1",
        profile: { role: "agent", approval_status: "approved" },
        profileKnown: true,
      }),
      { type: "redirect", pathname: "/" },
    )
    assert.deepEqual(
      decideSessionGate({
        path: "/pending-approval",
        userId: "user-1",
        profile: { role: "admin", approval_status: "pending" },
        profileKnown: true,
      }),
      { type: "redirect", pathname: "/" },
    )
  })
})

describe("withTimeout", () => {
  it("returns the value when the work finishes in time", async () => {
    const result = await withTimeout(Promise.resolve(42), 50)
    assert.deepEqual(result, { ok: true, value: 42 })
  })

  it("returns not-ok when the work hangs", async () => {
    const result = await withTimeout(new Promise<number>(() => undefined), 20)
    assert.deepEqual(result, { ok: false })
  })

  it("returns not-ok when the work throws", async () => {
    const result = await withTimeout(Promise.reject(new Error("nope")), 50)
    assert.deepEqual(result, { ok: false })
  })

  it("does not leave a late rejection unhandled after timeout", async () => {
    let rejectLate: ((error: Error) => void) | undefined
    const pending = new Promise<number>((_, reject) => {
      rejectLate = reject
    })
    const result = await withTimeout(pending, 20)
    assert.deepEqual(result, { ok: false })
    rejectLate?.(new Error("late abort"))
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
})

describe("navigation prefetch wiring", () => {
  it("middleware skips Auth before getUser on router prefetch", () => {
    const mw = readFileSync("lib/supabase/middleware.ts", "utf8")
    const prefetchAt = mw.indexOf("if (isRouterPrefetch(request.headers))")
    const clientAt = mw.indexOf("const supabase = createServerClient")
    const getUserAt = mw.indexOf("auth.getUser")
    assert.ok(prefetchAt >= 0)
    assert.ok(prefetchAt < clientAt)
    assert.ok(clientAt < getUserAt)
    const prefetchBlock = mw.slice(prefetchAt, mw.indexOf("let supabaseResponse"))
    assert.match(prefetchBlock, /NextResponse\.next/)
    assert.doesNotMatch(prefetchBlock, /auth\.getUser/)
  })

  it("shell nav warms routes on hover instead of viewport prefetch", () => {
    const nav = readFileSync("components/nav-link.tsx", "utf8")
    const portal = readFileSync("components/portal-layout.tsx", "utf8")
    const admin = readFileSync("components/admin-layout.tsx", "utf8")
    assert.match(nav, /router\.prefetch/)
    assert.match(nav, /prefetch = false/)
    assert.match(portal, /NavLink/)
    assert.match(admin, /NavLink/)
    assert.doesNotMatch(portal, /prefetch=\{false\}/)
    assert.doesNotMatch(admin, /prefetch=\{false\}/)
  })
})
