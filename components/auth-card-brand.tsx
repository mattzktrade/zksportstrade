import Image from "next/image"
import { LOGO_MAIN } from "@/lib/branding"

/** Logo + tagline for auth flow cards (login, signup, pending approval). */
export function AuthCardBrand() {
  return (
    <div className="flex flex-col items-center pb-2 border-b border-border/80">
      <Image
        src={LOGO_MAIN.src}
        alt="ZK Sports & Entertainment"
        width={LOGO_MAIN.width}
        height={LOGO_MAIN.height}
        className="h-11 w-auto"
        sizes="220px"
        priority
      />
      <p className="text-[10px] uppercase tracking-widest text-primary font-semibold mt-2">Trade Portal</p>
    </div>
  )
}
