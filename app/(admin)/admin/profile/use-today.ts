"use client"

import { useEffect, useState } from "react"

function localIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/** Viewer's local date as `YYYY-MM-DD`. Empty on the server render so due labels never mismatch on hydrate. */
export function useToday(): string {
  const [today, setToday] = useState("")
  useEffect(() => {
    setToday(localIsoDate(new Date()))
  }, [])
  return today
}

export function formatDueDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`)
  const sameYear = parsed.getFullYear() === new Date().getFullYear()
  return parsed.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  })
}
