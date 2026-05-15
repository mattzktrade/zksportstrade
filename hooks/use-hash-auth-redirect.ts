"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { hasHashAuthTokens, parseHashAuthParams } from "@/lib/supabase/hash-auth"

/**
 * Reads #access_token from the URL (recovery / confirm links), sets session, redirects.
 * Returns true while handling (show a loading state).
 */
export function useHashAuthRedirect(defaultNext = "/"): boolean {
  const router = useRouter()
  const [handling, setHandling] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return

    const hash = window.location.hash
    if (!hasHashAuthTokens(hash)) return

    let cancelled = false
    setHandling(true)

    const params = parseHashAuthParams(hash)
    const access_token = params.access_token
    const refresh_token = params.refresh_token
    const type = params.type

    if (!access_token || !refresh_token) {
      setHandling(false)
      return
    }

    const supabase = createClient()
    void supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (cancelled) return

      const search = new URLSearchParams(window.location.search)
      const nextParam = search.get("next")
      const cleanPath = window.location.pathname
      const cleanSearch = search.toString()
      const cleanUrl = cleanSearch ? `${cleanPath}?${cleanSearch}` : cleanPath
      window.history.replaceState(null, "", cleanUrl)

      if (error) {
        router.replace("/login?error=auth_callback")
        router.refresh()
        return
      }

      if (type === "recovery") {
        router.replace("/reset-password")
        router.refresh()
        return
      }

      const destination = nextParam && nextParam.startsWith("/") ? nextParam : defaultNext
      router.replace(destination)
      router.refresh()
    })

    return () => {
      cancelled = true
    }
  }, [defaultNext, router])

  return handling
}
