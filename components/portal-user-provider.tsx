"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { PortalProfile } from "@/lib/types/profile"

const PortalUserContext = createContext<PortalProfile | null>(null)

export function PortalUserProvider({ profile, children }: { profile: PortalProfile; children: ReactNode }) {
  return <PortalUserContext.Provider value={profile}>{children}</PortalUserContext.Provider>
}

export function usePortalUser(): PortalProfile {
  const ctx = useContext(PortalUserContext)
  if (!ctx) {
    throw new Error("usePortalUser must be used within PortalUserProvider")
  }
  return ctx
}
