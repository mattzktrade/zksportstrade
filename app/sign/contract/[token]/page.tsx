import { FileX2, TimerOff } from "lucide-react"
import { getPublicInclusionContract } from "@/lib/contracts/public"
import { ContractSigningClient } from "./signing-client"

export const dynamic = "force-dynamic"

export default async function ContractSigningPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const { form, unavailableReason } = await getPublicInclusionContract(token)

  if (!form) {
    const expired = unavailableReason === "expired"
    const Icon = expired ? TimerOff : FileX2
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f3f5f7] px-5 text-slate-900">
        <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <Icon className="mx-auto h-11 w-11 text-slate-400" />
          <h1 className="mt-4 text-xl font-bold">
            {expired ? "This signing link has expired" : "Contract unavailable"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {expired
              ? "Ask your ZK contact to send a fresh link. Nothing has been reserved against stock."
              : "This link is invalid, or the contract has been replaced. Contact your ZK representative if you still need to sign."}
          </p>
        </section>
      </main>
    )
  }

  return <ContractSigningClient token={token} form={form} />
}
