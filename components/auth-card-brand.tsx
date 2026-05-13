import Image from "next/image"

/** Logo + tagline for auth flow cards (login, signup, pending approval). */
export function AuthCardBrand() {
  return (
    <div className="flex flex-col items-center pb-2 border-b border-border/80">
      <Image src="/images/image.png" alt="ZK Sports & Entertainment" width={200} height={52} className="h-11 w-auto" priority />
      <p className="text-[10px] uppercase tracking-widest text-primary font-semibold mt-2">Trade Portal</p>
    </div>
  )
}
