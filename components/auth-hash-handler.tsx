"use client"

import { useHashAuthRedirect } from "@/hooks/use-hash-auth-redirect"
import { Loader2 } from "lucide-react"

type AuthHashHandlerProps = {
  defaultNext?: string
}

/** Landing page for Supabase links that return #access_token in the URL hash. */
export function AuthHashHandler({ defaultNext = "/" }: AuthHashHandlerProps) {
  const handling = useHashAuthRedirect(defaultNext)

  if (!handling) {
    return (
      <div className="bg-card border border-border rounded-2xl shadow-sm p-8 text-center">
        <p className="text-sm text-muted-foreground">
          If you followed a sign-in link, open it again or request a new link from the sign-in page.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm p-8 flex flex-col items-center justify-center gap-3 min-h-[120px]">
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
      <p className="text-sm text-muted-foreground">Completing sign-in…</p>
    </div>
  )
}
