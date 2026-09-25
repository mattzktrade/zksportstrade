"use client"

import { PROFILE_LOAD_TIMEOUT_MESSAGE } from "@/lib/supabase/session-guard"

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const timedOut = error.message === PROFILE_LOAD_TIMEOUT_MESSAGE

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#f7f8fa] px-6 text-center">
      <p className="max-w-sm text-sm text-slate-600">
        {timedOut ? error.message : "This page didn’t finish loading."}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-full bg-[#F90202] px-4 py-2 text-sm font-medium text-white"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800"
        >
          Refresh
        </button>
      </div>
    </div>
  )
}
