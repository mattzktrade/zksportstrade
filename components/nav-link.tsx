"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  useCallback,
  type ComponentProps,
  type FocusEvent,
  type MouseEvent,
  type TouchEvent,
} from "react"

function hrefPath(href: ComponentProps<typeof Link>["href"]): string | null {
  if (typeof href === "string") return href
  if (href && typeof href === "object" && typeof href.pathname === "string") return href.pathname
  return null
}

/**
 * Sidebar/header links: never viewport-prefetch (that 504'd live admin),
 * but start loading the target as soon as the pointer or keyboard reaches it.
 */
export function NavLink({
  href,
  onFocus,
  onMouseEnter,
  onTouchStart,
  prefetch = false,
  ...props
}: ComponentProps<typeof Link>) {
  const router = useRouter()
  const pathname = usePathname()

  const warm = useCallback(() => {
    const path = hrefPath(href)
    if (!path || !path.startsWith("/") || path === pathname) return
    void router.prefetch(path)
  }, [href, pathname, router])

  return (
    <Link
      {...props}
      href={href}
      prefetch={prefetch}
      onMouseEnter={(event: MouseEvent<HTMLAnchorElement>) => {
        warm()
        onMouseEnter?.(event)
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        warm()
        onFocus?.(event)
      }}
      onTouchStart={(event: TouchEvent<HTMLAnchorElement>) => {
        warm()
        onTouchStart?.(event)
      }}
    />
  )
}
