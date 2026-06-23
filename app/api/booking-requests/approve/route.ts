import { NextResponse } from "next/server"
import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import { verifyBookingApprovalApproveToken } from "@/lib/booking-approval/approve-token"
import { executeBookingApproval } from "@/lib/booking-approval/execute-approval"
import { getPortalProfile } from "@/lib/supabase/profile"

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function approvalResultPage(title: string, bodyHtml: string, status = 200): NextResponse {
  const siteOrigin = escapeHtml(getServerSiteOrigin())
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — ZK Sports &amp; Entertainment</title>
</head>
<body style="margin:0;padding:32px 16px;background:#fafafa;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:28px 24px;">
    <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">${escapeHtml(title)}</h1>
    ${bodyHtml}
    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#71717a;">
      <a href="${siteOrigin}/admin/booking-requests" style="color:#b91c1c;font-weight:600;">Open booking requests</a>
      ·
      <a href="${siteOrigin}/admin/orders" style="color:#b91c1c;font-weight:600;">View orders</a>
    </p>
  </div>
</body>
</html>`

  return new NextResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}

async function requireAdminApprovalPage(): Promise<NextResponse | null> {
  const profile = await getPortalProfile()
  if (!profile) {
    return approvalResultPage(
      "Sign in required",
      `<p style="margin:0;font-size:15px;line-height:1.6;color:#52525b;">Please sign in with an admin account, then open the approval link again.</p>`,
      401,
    )
  }
  if (profile.role !== "admin") {
    return approvalResultPage(
      "Admin access required",
      `<p style="margin:0;font-size:15px;line-height:1.6;color:#52525b;">Only admin users can approve booking requests from email links. Please review this request in the admin portal.</p>`,
      403,
    )
  }
  return null
}

export async function GET(request: Request): Promise<NextResponse> {
  const adminGate = await requireAdminApprovalPage()
  if (adminGate) return adminGate

  const token = new URL(request.url).searchParams.get("token")?.trim()
  if (!token) {
    return approvalResultPage(
      "Approval link missing",
      `<p style="margin:0;font-size:15px;line-height:1.6;color:#52525b;">This link is incomplete. Use the full link from the approval email, or review the request in the admin portal.</p>`,
      400,
    )
  }

  const verified = verifyBookingApprovalApproveToken(token)
  if (!verified.ok) {
    return approvalResultPage(
      "Could not approve request",
      `<p style="margin:0;font-size:15px;line-height:1.6;color:#52525b;">${escapeHtml(verified.error)}</p>`,
      400,
    )
  }

  return approvalResultPage(
    "Approve booking request",
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#52525b;">Please confirm you want to approve this booking request. This will reserve the stock, create the order, send the booking confirmation, and queue the invoice/integrations.</p>
     <form method="post" action="/api/booking-requests/approve" style="margin:0;">
       <input type="hidden" name="token" value="${escapeHtml(token)}" />
       <button type="submit" style="display:inline-block;border:0;border-radius:8px;background:#b91c1c;color:#ffffff;padding:12px 18px;font-size:14px;font-weight:700;cursor:pointer;">Approve booking</button>
     </form>
     <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#71717a;">If you are not ready to approve it, close this page and review the request in the admin portal.</p>`,
  )
}

export async function POST(request: Request): Promise<NextResponse> {
  const adminGate = await requireAdminApprovalPage()
  if (adminGate) return adminGate

  let token = ""
  try {
    const form = await request.formData()
    token = String(form.get("token") ?? "").trim()
  } catch {
    token = new URL(request.url).searchParams.get("token")?.trim() ?? ""
  }

  if (!token) {
    return approvalResultPage(
      "Approval link missing",
      `<p style="margin:0;font-size:15px;line-height:1.6;color:#52525b;">This approval request is incomplete. Use the full link from the approval email, or review the request in the admin portal.</p>`,
      400,
    )
  }

  const verified = verifyBookingApprovalApproveToken(token)
  if (!verified.ok) {
    return approvalResultPage(
      "Could not approve request",
      `<p style="margin:0;font-size:15px;line-height:1.6;color:#52525b;">${escapeHtml(verified.error)}</p>`,
      400,
    )
  }

  const result = await executeBookingApproval(verified.requestId)
  if (!result.ok) {
    return approvalResultPage(
      "Could not approve request",
      `<p style="margin:0;font-size:15px;line-height:1.6;color:#52525b;">${escapeHtml(result.message)}</p>`,
      400,
    )
  }

  const refLine = result.requestReference
    ? `<p style="margin:0 0 8px;font-size:14px;color:#52525b;"><strong>Request:</strong> ${escapeHtml(result.requestReference)}</p>`
    : ""

  const intro = result.alreadyApproved
    ? "This booking request was already approved."
    : "The booking request has been approved and the order has been created."

  return approvalResultPage(
    result.alreadyApproved ? "Already approved" : "Booking approved",
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#52525b;">${intro}</p>
     ${refLine}
     <p style="margin:0;font-size:16px;"><strong>Order reference:</strong> ${escapeHtml(result.orderReference)}</p>
     <p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#52525b;">The partner will receive their booking confirmation email if it has not been sent already.</p>`,
  )
}
