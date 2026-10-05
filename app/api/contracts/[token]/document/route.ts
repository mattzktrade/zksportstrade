import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { checkRateLimit, clientIpFromHeaders } from "@/lib/auth/rate-limit"
import { normalizeContractDraft } from "@/lib/contracts/content"
import { sha256 } from "@/lib/contracts/hash"
import { generateInclusionContractPdf } from "@/lib/contracts/pdf"
import { downloadContractDocument } from "@/lib/contracts/storage"
import { getPublicInclusionContract, publicContractDraft } from "@/lib/contracts/public"

export const runtime = "nodejs"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const ip = clientIpFromHeaders(request.headers)
  if (!checkRateLimit(`inclusion-contract:pdf:${ip}`, 40, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 })
  }
  const { token } = await context.params
  const { form } = await getPublicInclusionContract(token)
  if (!form) return NextResponse.json({ error: "Document not available." }, { status: 404 })

  try {
  let bytes: Uint8Array
  if (form.status === "signed") {
    const admin = createAdminClient()
    const { data } = admin
      ? await admin
          .from("inclusion_contracts")
          .select("signed_pdf_path")
          .eq("client_token_hash", sha256(token))
          .maybeSingle()
      : { data: null }
    if (data?.signed_pdf_path) {
      bytes = await downloadContractDocument(String(data.signed_pdf_path))
    } else {
      bytes = await generateInclusionContractPdf({
        documentRef: form.documentRef,
        draft: publicContractDraft(form),
        issuedAt: form.createdAt,
        signature: form.signerName
          ? {
              name: form.signerName,
              position: form.signerPosition ?? "",
              signedAt: form.signedAt ?? new Date().toISOString(),
            }
          : null,
      })
    }
  } else {
    bytes = await generateInclusionContractPdf({
      documentRef: form.documentRef,
      draft: normalizeContractDraft(publicContractDraft(form)),
      issuedAt: form.createdAt,
    })
  }

  const filename = `Inclusions-${form.documentRef.replace(/[^\w.-]+/g, "-")}.pdf`
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  })
  } catch {
    return NextResponse.json({ error: "Document not available." }, { status: 404 })
  }
}
