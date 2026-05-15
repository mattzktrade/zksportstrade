"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { safeRedirectPath } from "@/lib/auth/safe-redirect"
import { hasHashAuthTokens, parseHashAuthParams } from "@/lib/supabase/hash-auth"

/**
 * Reads #access_token from the URL (Supabase recovery / confirm links),
 * sets the session via cookies, then does a hard navigation so middleware
 * re-runs with the new auth cookies. Returns true while it's working so the
 * caller can show a loading state.
 */
export function useHashAuthRedirect(defaultNext = "/"): boolean {
  const [handling, setHandling] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return

    const hash = window.location.hash
    if (!hasHashAuthTokens(hash)) return

    setHandling(true)

    const params = parseHashAuthParams(hash)
    const access_token = params.access_token
    const refresh_token = params.refresh_token
    const type = params.type

    const search = new URLSearchParams(window.location.search)
    const nextParam = search.get("next")
    const cleanPath = window.location.pathname
    const cleanSearch = search.toString()
    const cleanUrl = cleanSearch ? `${cleanPath}?${cleanSearch}` : cleanPath
    try {
      window.history.replaceState(null, "", cleanUrl)
    } catch {
      // history may not be available; ignore
    }

    if (!access_token || !refresh_token) {
      window.location.replace("/login?error=auth_callback")
      return
    }

    const target =
      type === "recovery"
        ? "/reset-password"
        : safeRedirectPath(nextParam, safeRedirectPath(defaultNext, "/"))

    const safety = window.setTimeout(() => {
      window.location.replace("/login?error=auth_callback")
    }, 10000)

    const supabase = createClient()
    supabase.auth
      .setSession({ access_token, refresh_token })
      .then(({ error }) => {
        window.clearTimeout(safety)
        if (error) {
          window.location.replace("/login?error=auth_callback")
          return
        }
        window.location.replace(target)
      })
      .catch(() => {
        window.clearTimeout(safety)
        window.location.replace("/login?error=auth_callback")
      })
  }, [defaultNext])

  return handling
}
