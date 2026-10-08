import { after } from "next/server"

/** Run work after the HTTP response so signing UIs can return immediately. */
export function scheduleAfterResponse(work: () => Promise<void>): void {
  const run = () =>
    work().catch((error) => {
      console.error("[booking-forms] background work failed:", error instanceof Error ? error.message : error)
    })
  try {
    after(run)
  } catch {
    run()
  }
}
