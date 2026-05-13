import Image from "next/image"
import type { ReactNode } from "react"

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/40 flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="mb-8 text-center">
        <Image src="/images/image.png" alt="ZK Sports & Entertainment" width={180} height={48} className="h-10 w-auto mx-auto" priority />
        <p className="text-[10px] uppercase tracking-widest text-primary font-semibold mt-2">Trade Portal</p>
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}
