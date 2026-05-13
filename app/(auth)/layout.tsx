import type { ReactNode } from "react"

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/50 to-muted/30 flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}
