"use client"

import type React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import Image from "next/image"
import {
  LayoutDashboard,
  Users,
  Boxes,
  UserCircle,
  LogOut,
  Menu,
  X,
  ArrowLeft,
  ShoppingCart,
  ShieldCheck,
  FileText,
  PackageSearch,
  ChevronDown,
  CircleDollarSign,
  Settings,
  Megaphone,
  Wrench,
  BriefcaseBusiness,
  Building2,
  AlertTriangle,
  Warehouse,
  CalendarDays,
  TrendingUp,
  CircleHelp,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { LOGO_WHITE } from "@/lib/branding"
import { AdminJumpSearch, type AdminJumpItem } from "@/components/admin/admin-jump-search"
import { escapeCloseProps } from "@/lib/browser/laptop-qol"

type NavItem = {
  name: string
  href?: string
  icon: React.ComponentType<{ className?: string }>
  disabled?: boolean
  children?: Array<{ name: string; href: string; icon?: React.ComponentType<{ className?: string }> }>
}

const navigation: NavItem[] = [
  { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
  {
    name: "Portal",
    icon: PackageSearch,
    children: [
      { name: "Pending users", href: "/admin/pending-users", icon: Users },
      { name: "Paddock requests", href: "/admin/booking-requests", icon: ShieldCheck },
      { name: "Holds", href: "/admin/inventory", icon: Boxes },
      { name: "Agents", href: "/admin/agents", icon: UserCircle },
      { name: "Place order", href: "/admin/place-order", icon: ShoppingCart },
    ],
  },
  {
    name: "Inventory",
    icon: Warehouse,
    children: [
      { name: "Sales list", href: "/admin/inventory/sales-list", icon: PackageSearch },
      { name: "Negative stock list", href: "/admin/inventory/negative-stock", icon: AlertTriangle },
      { name: "Manage inventory", href: "/admin/catalog", icon: Warehouse },
      { name: "Events", href: "/admin/catalog/events", icon: CalendarDays },
      { name: "Purchase orders", href: "/admin/purchase-orders", icon: FileText },
      { name: "Suppliers", href: "/admin/suppliers", icon: Building2 },
    ],
  },
  {
    name: "Sales",
    icon: BriefcaseBusiness,
    children: [
      { name: "Accounts", href: "/admin/leads", icon: Users },
      { name: "Deals", href: "/admin/deals", icon: BriefcaseBusiness },
      { name: "Sales tracker", href: "/admin/sales-tracker", icon: TrendingUp },
      { name: "CRM imports", href: "/admin/imports", icon: FileText },
    ],
  },
  { name: "Operations", href: "/admin/operations", icon: Wrench },
  { name: "Finance", href: "/admin/finance", icon: CircleDollarSign },
  { name: "Marketing", icon: Megaphone, disabled: true },
  { name: "Help", href: "/admin/help", icon: CircleHelp },
  { name: "Settings", href: "/admin/settings", icon: Settings },
]

const JUMP_KEYWORDS: Record<string, string> = {
  "/admin/leads": "leads clients companies contacts people",
  "/admin/deals": "pipeline crm sales",
  "/admin/catalog/events": "races calendar",
  "/admin/orders": "bookings invoices portal",
  "/admin/finance": "invoices payments xero",
}

const adminJumpDestinations: AdminJumpItem[] = [
  ...navigation.flatMap((item): AdminJumpItem[] => {
    if (item.disabled) return []
    const self: AdminJumpItem[] = item.href ? [{ label: item.name, href: item.href }] : []
    const children: AdminJumpItem[] = (item.children ?? []).map((child) => ({
      label: child.name,
      href: child.href,
    }))
    return [...self, ...children]
  }),
  { label: "Trade portal", href: "/", keywords: "home packages bookings" },
  { label: "Orders", href: "/admin/orders", keywords: JUMP_KEYWORDS["/admin/orders"] },
].map((item) =>
  JUMP_KEYWORDS[item.href] && !item.keywords ? { ...item, keywords: JUMP_KEYWORDS[item.href] } : item,
)

function adminPageTitle(pathname: string): string {
  if (pathname === "/admin") return "Dashboard"
  if (pathname.startsWith("/admin/finance")) return "Finance"
  if (pathname.startsWith("/admin/operations")) return "Operations"
  if (pathname.startsWith("/admin/deals")) return "Deals"
  if (pathname.startsWith("/admin/leads") || pathname.startsWith("/admin/clients")) return "Accounts"
  if (pathname.startsWith("/admin/sales-tracker")) return "Sales tracker"
  if (pathname.startsWith("/admin/imports")) return "CRM imports"
  if (pathname.startsWith("/admin/catalog/events")) return "Events"
  if (pathname.startsWith("/admin/catalog")) return "Inventory"
  if (pathname.startsWith("/admin/inventory/sales-list")) return "Sales list"
  if (pathname.startsWith("/admin/inventory/negative-stock")) return "Negative stock"
  if (pathname.startsWith("/admin/inventory")) return "Holds"
  if (pathname.startsWith("/admin/purchase-orders")) return "Purchase orders"
  if (pathname.startsWith("/admin/suppliers")) return "Suppliers"
  if (pathname.startsWith("/admin/pending-users")) return "Pending users"
  if (pathname.startsWith("/admin/booking-requests")) return "Paddock requests"
  if (pathname.startsWith("/admin/agents")) return "Agents"
  if (pathname.startsWith("/admin/place-order")) return "Place order"
  if (pathname.startsWith("/admin/help")) return "Help"
  if (pathname.startsWith("/admin/settings") || pathname.startsWith("/admin/integrations")) return "Settings"
  return "Admin"
}

function itemIsActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin"
  const path = href.split("?")[0]
  if (path === "/admin/catalog" && pathname.startsWith("/admin/catalog/events")) return false
  if (path === "/admin/settings" && pathname.startsWith("/admin/integrations")) return true
  return pathname === path || pathname.startsWith(`${path}/`)
}

export function AdminLayout({
  children,
  profileName = "Admin",
}: {
  children: React.ReactNode
  profileName?: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    Inventory: pathname.startsWith("/admin/catalog") ||
      pathname.startsWith("/admin/purchase-orders") ||
      pathname.startsWith("/admin/suppliers") ||
      pathname.startsWith("/admin/inventory/sales-list") ||
      pathname.startsWith("/admin/inventory/negative-stock"),
    Portal: pathname.startsWith("/admin/pending-users") ||
      pathname.startsWith("/admin/booking-requests") ||
      pathname === "/admin/inventory" ||
      pathname.startsWith("/admin/agents") ||
      pathname.startsWith("/admin/place-order"),
    Sales:
      pathname.startsWith("/admin/leads") ||
      pathname.startsWith("/admin/deals") ||
      pathname.startsWith("/admin/sales-tracker") ||
      pathname.startsWith("/admin/imports"),
  })

  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <div className="admin-shell min-h-dvh bg-[#f7f8fa]">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-zk-black/50 z-40 lg:hidden"
          {...escapeCloseProps}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-dvh overscroll-contain bg-[#070707] text-slate-100 border-r border-white/10 flex flex-col transition-transform duration-300 lg:translate-x-0 w-[min(224px,86vw)] lg:w-[224px] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between gap-2 border-b border-white/10 px-4">
          <Link href="/admin" className="block min-w-0">
            <Image
              src={LOGO_WHITE.src}
              alt="ZK Sports & Entertainment"
              width={LOGO_WHITE.width}
              height={LOGO_WHITE.height}
              className="h-11 w-auto max-w-full"
              sizes="192px"
              priority
            />
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="flex h-10 w-10 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="no-scrollbar flex-1 overflow-y-auto overscroll-contain p-2.5 space-y-1">
          {navigation.map((item) => {
            const isActive = item.href ? itemIsActive(pathname, item.href) : false
            const childActive = item.children?.some((child) => itemIsActive(pathname, child.href)) ?? false
            const expanded = openGroups[item.name] ?? childActive

            if (item.children) {
              return (
                <div key={item.name}>
                  <button
                    type="button"
                    onClick={() => setOpenGroups((prev) => ({ ...prev, [item.name]: !expanded }))}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2.5 text-[12px] transition-colors lg:py-2",
                      childActive ? "text-white" : "text-slate-400 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <item.icon className={cn("h-4 w-4 shrink-0", childActive && "text-primary")} />
                    <span className="flex-1 text-left">{item.name}</span>
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
                  </button>
                  {expanded ? (
                    <div className="mt-0.5 space-y-0.5">
                      {item.children.map((child) => {
                        const active = itemIsActive(pathname, child.href)
                        const ChildIcon = child.icon
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={cn(
                              "relative flex items-center gap-2 pl-8 pr-2.5 py-2.5 rounded-md text-[11px] transition-colors lg:py-2",
                              active
                                ? "bg-white/10 text-white font-medium"
                                : "text-slate-500 hover:bg-white/5 hover:text-slate-200",
                            )}
                          >
                            {active ? (
                              <span className="absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-primary" />
                            ) : null}
                            {ChildIcon ? <ChildIcon className={cn("h-3.5 w-3.5", active && "text-primary")} /> : null}
                            <span>{child.name}</span>
                          </Link>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              )
            }

            if (item.disabled) {
              return (
                <div
                  key={item.name}
                  title="Coming soon"
                  className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px] text-slate-600"
                >
                  <item.icon className="h-4 w-4 flex-shrink-0" />
                  <span>{item.name}</span>
                </div>
              )
            }

            return (
              <Link
                key={item.name}
                href={item.href!}
                className={cn(
                  "relative flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-[12px] transition-all lg:py-2",
                  isActive
                    ? "text-white font-medium bg-white/10"
                    : "text-slate-400 hover:text-white hover:bg-white/5",
                )}
              >
                {isActive && (
                  <span className="absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-primary" />
                )}
                <item.icon className={cn("h-4 w-4 flex-shrink-0", isActive ? "text-primary" : "")} />
                <span>{item.name}</span>
              </Link>
            )
          })}
        </nav>

        <div className="p-3 border-t border-white/10 space-y-1">
          <Link
            href="/"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-slate-400 hover:text-white hover:bg-white/5"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Trade portal
          </Link>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-xs text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="lg:pl-[224px]">
        <header className="sticky top-0 z-30 border-b border-[#e9eaee] bg-white pt-[env(safe-area-inset-top)]">
          <div className="flex h-14 items-center justify-between gap-3 px-3 sm:h-16 sm:px-4 lg:px-7">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-muted lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-800 md:hidden">
              {adminPageTitle(pathname)}
            </p>
            <AdminJumpSearch destinations={adminJumpDestinations} />
            <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                {profileName.trim().charAt(0).toUpperCase() || "A"}
              </div>
              <p className="hidden max-w-[160px] truncate text-[11px] font-semibold text-slate-800 sm:block">
                {profileName}
              </p>
            </div>
          </div>
        </header>

        <main className="min-h-[calc(100dvh-64px)] min-w-0">{children}</main>
      </div>
    </div>
  )
}
