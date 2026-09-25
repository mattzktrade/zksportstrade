"use client"

import Link from "next/link"
import type { ComponentProps } from "react"

/**
 * In-app links. Prefetch stays off: a hovered prefetch that stalled used to
 * swallow the following click until a full refresh.
 */
export function NavLink({ href, prefetch = false, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props} href={href} prefetch={prefetch} />
}
