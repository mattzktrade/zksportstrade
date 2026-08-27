"use client"

import {
  useEffect,
  useState,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from "react"
import { createPortal } from "react-dom"
import { escapeCloseProps } from "@/lib/browser/laptop-qol"
import { cn } from "@/lib/utils"

let bodyScrollLocks = 0
let prevHtmlOverflow = ""
let prevBodyOverflow = ""
let prevBodyOverscroll = ""

function lockBodyScroll() {
  if (typeof document === "undefined") return
  if (bodyScrollLocks === 0) {
    prevHtmlOverflow = document.documentElement.style.overflow
    prevBodyOverflow = document.body.style.overflow
    prevBodyOverscroll = document.body.style.overscrollBehavior
    document.documentElement.style.overflow = "hidden"
    document.body.style.overflow = "hidden"
    document.body.style.overscrollBehavior = "none"
  }
  bodyScrollLocks += 1
}

function unlockBodyScroll() {
  if (typeof document === "undefined") return
  bodyScrollLocks = Math.max(0, bodyScrollLocks - 1)
  if (bodyScrollLocks > 0) return
  document.documentElement.style.overflow = prevHtmlOverflow
  document.body.style.overflow = prevBodyOverflow
  document.body.style.overscrollBehavior = prevBodyOverscroll
}

export function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    lockBodyScroll()
    return () => unlockBodyScroll()
  }, [locked])
}

export function AdminBodyPortal({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" ? document.body : null,
  )
  useEffect(() => {
    setTarget(document.body)
  }, [])
  if (!target) return null
  return createPortal(children, target)
}

/** List-row preview: in-flow sidebar on desktop, true fullscreen sheet on smaller screens. */
export function AdminListPreview({
  isDesktop,
  onClose,
  children,
  className,
  desktopClassName,
  previewRef,
}: {
  isDesktop: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  desktopClassName?: string
  previewRef?: Ref<HTMLElement>
}) {
  useLockBodyScroll(!isDesktop)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  if (isDesktop) {
    return (
      <aside
        ref={previewRef}
        className={cn(
          "min-w-0 overflow-x-hidden bg-white xl:sticky xl:top-16 xl:z-20 xl:max-h-[calc(100dvh-4rem)] xl:overflow-y-auto xl:overscroll-contain",
          desktopClassName,
          className,
        )}
      >
        {children}
      </aside>
    )
  }

  return (
    <AdminBodyPortal>
      <aside
        ref={previewRef}
        role="dialog"
        aria-modal="true"
        className={cn(
          "fixed inset-0 z-[70] flex h-dvh w-full flex-col overflow-y-auto overscroll-contain bg-white",
          "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
          className,
        )}
      >
        {children}
      </aside>
    </AdminBodyPortal>
  )
}

const modalPanelClass =
  "flex h-dvh min-h-0 w-full max-w-5xl flex-col bg-white shadow-2xl sm:h-auto sm:max-h-[92dvh] sm:rounded-xl"

/** Full-viewport dialog on phones so the page behind cannot move or zoom. */
export function AdminModalScrim({
  children,
  onClose,
  zClassName = "z-[85]",
  panelClassName,
}: {
  children: ReactNode
  onClose: () => void
  zClassName?: string
  panelClassName?: string
}) {
  useLockBodyScroll(true)

  function stop(event: MouseEvent<HTMLDivElement>) {
    event.stopPropagation()
  }

  return (
    <AdminBodyPortal>
      <div
        className={cn(
          "fixed inset-0 flex items-stretch justify-center bg-black/40 p-0 sm:items-center sm:p-4",
          zClassName,
        )}
        {...escapeCloseProps}
        onClick={onClose}
      >
        <div className={cn(modalPanelClass, panelClassName)} onClick={stop}>
          {children}
        </div>
      </div>
    </AdminBodyPortal>
  )
}
