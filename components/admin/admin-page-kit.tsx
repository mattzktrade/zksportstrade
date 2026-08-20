import type React from "react"
import Link from "next/link"
import { ArrowUpRight, Search } from "lucide-react"
import { cn } from "@/lib/utils"

export function AdminPageHeader({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#18191c]">{title}</h1>
        <p className="mt-0.5 hidden text-[11px] text-[#80848d] sm:block">{description}</p>
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{action}</div> : null}
    </div>
  )
}

/** Summary cards at the top of admin pages. Hidden on phones so the work list comes first. */
export function AdminStats({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("admin-stats hidden md:grid gap-2", className)}>
      {children}
    </section>
  )
}

export function AdminDesktopTable({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn("hidden overflow-x-auto md:block", className)}>{children}</div>
}

export function AdminMobileList({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn("divide-y divide-[#f0f1f3] md:hidden", className)}>{children}</div>
}

type Tone = "red" | "blue" | "green" | "purple" | "amber"

const toneClass: Record<Tone, string> = {
  red: "bg-red-50 text-primary",
  blue: "bg-blue-50 text-blue-600",
  green: "bg-emerald-50 text-emerald-600",
  purple: "bg-violet-50 text-violet-600",
  amber: "bg-amber-50 text-amber-600",
}

export function AdminStatCard({
  icon: Icon,
  value,
  label,
  hint,
  tone = "red",
  href,
}: {
  icon: React.ComponentType<{ className?: string }>
  value: string | number
  label: string
  hint?: string
  tone?: Tone
  href?: string
}) {
  const content = (
    <>
      <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", toneClass[tone])}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[18px] font-semibold leading-none tabular-nums text-[#202124]">{value}</p>
        <p className="mt-1 text-[10px] font-medium text-[#555961]">{label}</p>
        {hint ? <p className="mt-1 text-[9px] text-[#a0a3a9]">{hint}</p> : null}
      </div>
    </>
  )

  const classes =
    "flex min-h-[78px] items-center gap-4 rounded-lg border border-[#eceef1] bg-white px-5 py-4"

  return href ? (
    <Link href={href} className={cn(classes, "transition-colors hover:border-primary/30")}>
      {content}
    </Link>
  ) : (
    <div className={classes}>{content}</div>
  )
}

export function AdminFilterBar({
  placeholder,
  children,
  actions,
}: {
  placeholder: string
  children?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[#eceef1] px-3 py-3">
      <div className="relative min-w-0 w-full flex-1 sm:min-w-[220px] sm:max-w-[340px]">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          placeholder={placeholder}
          className="h-8 w-full rounded-md border border-[#e5e7eb] bg-white pl-9 pr-3 text-[10px] outline-none placeholder:text-[#a0a3a9] focus:border-primary/40"
        />
      </div>
      {children}
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </div>
  )
}

export function AdminFilterButton({
  children,
  active,
}: {
  children: React.ReactNode
  active?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        "h-8 rounded-md border px-3 text-[10px] font-medium",
        active
          ? "border-primary bg-red-50 text-primary"
          : "border-[#e5e7eb] bg-white text-[#5f636b] hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  )
}

export function AdminPanel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-[#eceef1] bg-white", className)}>
      {children}
    </div>
  )
}

export function SectionTitle({
  title,
  href,
  hrefLabel = "View all",
  action,
}: {
  title: string
  href?: string
  hrefLabel?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between border-b border-[#eceef1] px-4 py-3">
      <h2 className="text-[11px] font-semibold text-[#25272b]">{title}</h2>
      {action ? action : href ? (
        <Link href={href} className="flex items-center gap-1 text-[9px] font-medium text-primary hover:underline">
          {hrefLabel}
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      ) : null}
    </div>
  )
}

export function StatusPill({
  children,
  tone = "green",
}: {
  children: React.ReactNode
  tone?: "green" | "amber" | "red" | "blue" | "purple" | "gray"
}) {
  const classes = {
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    blue: "bg-blue-50 text-blue-700",
    purple: "bg-violet-50 text-violet-700",
    gray: "bg-slate-100 text-slate-600",
  }
  return (
    <span className={cn("inline-flex rounded px-1.5 py-1 text-[8px] font-medium", classes[tone])}>
      {children}
    </span>
  )
}
