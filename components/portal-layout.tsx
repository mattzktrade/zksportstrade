"use client"

import type React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import Image from "next/image"
import { LayoutDashboard, Ticket, CalendarCheck, HelpCircle, LogOut, Menu, Shield } from "lucide-react"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { usePortalUser } from "@/components/portal-user-provider"
import { LOGO_MAIN } from "@/lib/branding"
import { ContactWidget } from "@/components/contact-widget"

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const profile = usePortalUser()
  const displayName = profile.full_name || profile.email.split("@")[0] || "Partner"

  const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "All Packages", href: "/packages", icon: Ticket },
    { name: "My Bookings", href: "/bookings", icon: CalendarCheck },
    { name: "FAQs", href: "/faqs", icon: HelpCircle },
    ...(profile.role === "admin" ? [{ name: "Admin", href: "/admin", icon: Shield }] : []),
  ]

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-muted/30">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-zk-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-full bg-white border-r border-border flex flex-col transition-all duration-300 lg:translate-x-0 w-56",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="border-b border-border p-5">
          <Link href="/" className="block">
            <Image
              src={LOGO_MAIN.src}
              alt="ZK Sports & Entertainment"
              width={LOGO_MAIN.width}
              height={LOGO_MAIN.height}
              className="h-9 w-auto"
              sizes="160px"
              priority
            />
            <p className="text-[9px] uppercase tracking-widest text-primary font-semibold mt-1.5">Trade Portal</p>
          </Link>
        </div>

        <nav className="flex-1 p-3 space-y-0.5">
          {navigation.map((item) => {
            const isActive =
              item.href === "/admin"
                ? pathname === "/admin" || pathname.startsWith("/admin/")
                : pathname === item.href
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all relative",
                  isActive
                    ? "text-primary font-medium bg-primary/5"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-primary rounded-r-full" />
                )}
                <item.icon className={cn("h-[18px] w-[18px] flex-shrink-0", isActive ? "text-primary" : "")} />
                <span>{item.name}</span>
              </Link>
            )
          })}
        </nav>

        <div className="p-3 border-t border-border">
          <Link
            href="/profile"
            className="flex items-center gap-2.5 p-2 rounded-md hover:bg-muted/50 transition-colors"
          >
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-primary/80 text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {displayName
                .split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
              <p className="text-[11px] text-muted-foreground truncate">{profile.company_name || profile.email}</p>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="flex items-center gap-2.5 w-full px-2 py-2 mt-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
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
            <Image
              src={LOGO_MAIN.src}
              alt="ZK Sports & Entertainment"
              width={LOGO_MAIN.width}
              height={LOGO_MAIN.height}
              className="h-6 w-auto"
              sizes="120px"
            />
            <Link
              href="/profile"
              className="h-8 w-8 rounded-full bg-primary text-white flex items-center justify-center text-xs font-semibold"
            >
              {displayName
                .split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </Link>
          </div>
        </header>

        <main className="min-h-[calc(100vh-56px)] lg:min-h-screen">{children}</main>
      </div>
      <ContactWidget />
    </div>
  )
}
