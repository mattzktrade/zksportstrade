import { Resend } from "resend"
import { getResendApiKey, getResendFromAddress } from "@/lib/email/config"

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export type AgentApprovedEmailPayload = {
  agentEmail: string
  agentName: string
  companyName: string
  siteOrigin: string
}

export function buildAgentApprovedHtml(p: AgentApprovedEmailPayload): string {
  const loginUrl = escapeHtml(`${p.siteOrigin}/login`)
  const name = escapeHtml(p.agentName)
  const email = escapeHtml(p.agentEmail)
  const company = p.companyName.trim() ? escapeHtml(p.companyName.trim()) : ""

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your trade portal account is approved</title>
</head>
<body style="margin:0;padding:0;background-color:#ececef;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;">Your ZK Sports trade portal account is approved. Sign in to browse packages and book.</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ececef;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4e4e7;">
          <tr>
            <td style="background-color:#b91c1c;padding:22px 24px;text-align:center;">
              <p style="margin:0;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;">Account approved</p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 8px;font-family:Arial,Helvetica,sans-serif;">
              <h1 style="margin:0 0 16px;color:#18181b;font-size:22px;font-weight:700;line-height:1.3;">Welcome to the ZK trade portal</h1>
              <p style="margin:0 0 18px;color:#3f3f46;font-size:15px;line-height:1.65;">
                Hi ${name}, your trade portal account${company ? ` for <strong>${company}</strong>` : ""} has been approved. You can now sign in to browse packages, check live availability, and place bookings.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;background-color:#fafafa;border:1px solid #e4e4e7;border-radius:10px;">
                <tr>
                  <td style="padding:14px 16px;">
                    <p style="margin:0 0 6px;color:#71717a;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Sign in with</p>
                    <p style="margin:0;color:#18181b;font-size:15px;font-weight:600;word-break:break-word;">${email}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 28px;font-family:Arial,Helvetica,sans-serif;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#b91c1c" style="border-radius:10px;">
                    <a href="${loginUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:15px 36px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">Sign in to the portal</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0;color:#52525b;font-size:13px;line-height:1.6;">
                <strong style="color:#18181b;">Forgotten your password?</strong><br>
                Use <strong>Forgot password?</strong> on the <a href="${loginUrl}" style="color:#b91c1c;font-weight:600;text-decoration:underline;">sign-in page</a> to set a new one.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px;background-color:#fafafa;border-top:1px solid #e4e4e7;text-align:center;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0;color:#a1a1aa;font-size:11px;">ZK Sports &amp; Entertainment · Trade portal</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export async function sendAgentApprovedEmail(
  p: AgentApprovedEmailPayload,
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const apiKey = getResendApiKey()
  const from = getResendFromAddress()
  if (!apiKey || !from) {
    return { ok: false, skipped: "RESEND_API_KEY or email FROM not configured" }
  }

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from,
    to: [p.agentEmail],
    subject: "Your ZK Sports trade portal account is approved",
    html: buildAgentApprovedHtml(p),
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
