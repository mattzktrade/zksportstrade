"use client"

import type React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import Image from "next/image"
import { LayoutDashboard, Ticket, CalendarCheck, FileText, HelpCircle, LogOut, Menu, ChevronLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { currentAgent } from "@/lib/data"
import { useState } from "react"

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "All Packages", href: "/packages", icon: Ticket },
  { name: "My Bookings", href: "/bookings", icon: CalendarCheck },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "FAQs", href: "/faqs", icon: HelpCircle },
]

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar - Made slimmer (w-56 vs w-64), added collapse functionality */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-full bg-white border-r border-border flex flex-col transition-all duration-300 lg:translate-x-0",
          collapsed ? "w-[72px]" : "w-56",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Logo */}
        <div className={cn("border-b border-border", collapsed ? "p-4" : "p-5")}>
          <Link href="/" className="block">
            {collapsed ? (
              <div className="h-10 w-10 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">ZK</span>
              </div>
            ) : (
              <>
                <Image
                  src="/images/image.png"
                  alt="ZK Sports & Entertainment"
                  width={160}
                  height={40}
                  className="h-9 w-auto"
                  priority
                />
                <p className="text-[9px] uppercase tracking-widest text-primary font-semibold mt-1.5">Trade Portal</p>
              </>
            )}
          </Link>
        </div>

        {/* Navigation - Subtler active state with left border accent */}
        <nav className="flex-1 p-3 space-y-0.5">
          {navigation.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                title={collapsed ? item.name : undefined}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all relative",
                  isActive
                    ? "text-primary font-medium bg-primary/5"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  collapsed && "justify-center px-0",
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-primary rounded-r-full" />
                )}
                <item.icon className={cn("h-[18px] w-[18px] flex-shrink-0", isActive ? "text-primary" : "")} />
                {!collapsed && <span>{item.name}</span>}
              </Link>
            )
          })}
        </nav>

        {/* Collapse toggle - Added collapse button */}
        <div className="px-3 py-2 border-t border-border">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center justify-center w-full py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
            {!collapsed && <span className="ml-2 text-xs">Collapse</span>}
          </button>
        </div>

        {/* Agent Profile - Simplified profile section */}
        <div className={cn("p-3 border-t border-border", collapsed && "px-2")}>
          <Link
            href="/profile"
            className={cn(
              "flex items-center gap-2.5 p-2 rounded-md hover:bg-muted/50 transition-colors",
              collapsed && "justify-center p-2",
            )}
            title={collapsed ? currentAgent.name : undefined}
          >
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-primary/80 text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {currentAgent.name
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{currentAgent.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">{currentAgent.agency}</p>
              </div>
            )}
          </Link>
          {!collapsed && (
            <button className="flex items-center gap-2.5 w-full px-2 py-2 mt-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </button>
          )}
        </div>
      </aside>

      {/* Main content area - Adjusted padding for slimmer sidebar */}
      <div className={cn("transition-all duration-300", collapsed ? "lg:pl-[72px]" : "lg:pl-56")}>
        {/* Mobile header */}
        <header className="sticky top-0 z-30 bg-white border-b border-border lg:hidden">
          <div className="flex items-center justify-between h-14 px-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-muted"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Image
              src="/images/image.png"
              alt="ZK Sports & Entertainment"
              width={120}
              height={30}
              className="h-6 w-auto"
            />
            <Link
              href="/profile"
              className="h-8 w-8 rounded-full bg-primary text-white flex items-center justify-center text-xs font-semibold"
            >
              {currentAgent.name
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </Link>
          </div>
        </header>

        {/* Page content */}
        <main className="min-h-[calc(100vh-56px)] lg:min-h-screen">{children}</main>
      </div>
    </div>
  )
}
