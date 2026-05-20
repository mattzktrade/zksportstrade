"use client"

import type React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import Image from "next/image"
import {
  LayoutDashboard,
  Users,
  Ticket,
  Boxes,
  UserCircle,
  LogOut,
  Menu,
  ArrowLeft,
  ClipboardList,
  ShoppingCart,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { createClient } from "@/lib/supabase/client"

const navigation = [
  { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { name: "Pending users", href: "/admin/pending-users", icon: Users },
  { name: "Catalog", href: "/admin/catalog", icon: Ticket },
  { name: "Holds", href: "/admin/inventory", icon: Boxes },
  { name: "Orders", href: "/admin/orders", icon: ClipboardList },
  { name: "Place order", href: "/admin/place-order", icon: ShoppingCart },
  { name: "Agents", href: "/admin/agents", icon: UserCircle },
]

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-muted/30">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-full bg-slate-950 text-slate-100 border-r border-slate-800 flex flex-col transition-all duration-300 lg:translate-x-0 w-56",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="border-b border-slate-800 p-5">
          <Link href="/admin" className="block">
            <Image
              src="/images/ZK%20white%20logo.png"
              alt="ZK Sports & Entertainment"
              width={180}
              height={48}
              className="h-9 w-auto"
              priority
            />
            <p className="text-[9px] uppercase tracking-widest text-red-400 font-semibold mt-1.5">Admin</p>
          </Link>
        </div>

        <nav className="flex-1 p-3 space-y-0.5">
          {navigation.map((item) => {
            const isActive =
              item.href === "/admin" ? pathname === "/admin" : pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all relative",
                  isActive
                    ? "text-white font-medium bg-white/10"
                    : "text-slate-400 hover:text-white hover:bg-white/5",
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-red-500 rounded-r-full" />
                )}
                <item.icon className={cn("h-[18px] w-[18px] flex-shrink-0", isActive ? "text-red-400" : "")} />
                <span>{item.name}</span>
              </Link>
            )
          })}
        </nav>

        <div className="p-3 border-t border-slate-800 space-y-1">
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

      <div className="lg:pl-56 transition-all duration-300">
        <header className="sticky top-0 z-30 bg-white border-b border-border lg:hidden">
          <div className="flex items-center justify-between h-14 px-4">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-muted"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-semibold text-foreground">Admin</span>
            <Link href="/" className="text-xs text-primary font-medium">
              Portal
            </Link>
          </div>
        </header>

        <main className="min-h-[calc(100vh-56px)] lg:min-h-screen">{children}</main>
      </div>
    </div>
  )
}
