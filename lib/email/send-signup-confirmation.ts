import { Resend } from "resend"
import { createAdminClient } from "@/lib/supabase/admin"
import { getResendApiKey, getResendFromAddress } from "@/lib/email/config"

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export function buildSignupConfirmationHtml(confirmLink: string, email: string, siteOrigin: string): string {
  const safeLink = escapeHtml(confirmLink)
  const safeEmail = escapeHtml(email)
  const safeOrigin = escapeHtml(siteOrigin)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Confirm your email</title>
</head>
<body style="margin:0;padding:0;background-color:#ececef;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    Finish setting up your trade portal account — confirm your email when you are ready.
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ececef;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4e4e7;">
          <tr>
            <td style="background-color:#b91c1c;padding:22px 24px;text-align:center;">
              <p style="margin:0;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;letter-spacing:0.02em;">Confirm your email</p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 8px;font-family:Arial,Helvetica,sans-serif;">
              <h1 style="margin:0 0 16px;color:#18181b;font-size:22px;font-weight:700;line-height:1.3;">One more step</h1>
              <p style="margin:0 0 18px;color:#3f3f46;font-size:15px;line-height:1.65;">
                Use the button below to verify this address and activate your trade portal account. The link expires after a short time for security — if that happens, request a fresh one from the sign-in page.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;background-color:#fafafa;border:1px solid #e4e4e7;border-radius:10px;">
                <tr>
                  <td style="padding:14px 16px;">
                    <p style="margin:0 0 6px;color:#71717a;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Email on this account</p>
                    <p style="margin:0;color:#18181b;font-size:15px;font-weight:600;line-height:1.45;word-break:break-word;">${safeEmail}</p>
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
                    <a href="${safeLink}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:15px 36px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">Verify email address</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0;padding:14px 16px;background-color:#fafafa;border:1px solid #e4e4e7;border-radius:10px;color:#52525b;font-size:13px;line-height:1.55;">
                <strong style="color:#18181b;">Button not working?</strong><br>
                <a href="${safeLink}" target="_blank" rel="noopener noreferrer" style="color:#b91c1c;font-weight:600;word-break:break-all;text-decoration:underline;">${safeLink}</a>
              </p>
              <p style="margin:16px 0 0;color:#52525b;font-size:13px;line-height:1.6;">
                <strong style="color:#18181b;">Link expired?</strong><br>
                <a href="${safeOrigin}/login" style="color:#b91c1c;font-weight:600;text-decoration:underline;">Open the sign-in page</a>, enter your email and password, then use <strong style="color:#18181b;">Resend verification email</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0;color:#a1a1aa;font-size:12px;line-height:1.6;text-align:center;">
                If you did not request a trade portal account, you can ignore this email.
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

export type SignupConfirmationEmailResult =
  | { ok: true; via: "resend" }
  | { ok: false; error: string }
  | { ok: false; skipped: string }

/**
 * Sends a signup confirmation email via Resend, bypassing Supabase's built-in
 * email service (which is heavily rate-limited and often lands in spam).
 *
 * Uses admin.generateLink with type=magiclink to mint a verification link for
 * the (already-created, unconfirmed) user. Clicking the link signs them in via
 * the existing /auth/callback handler, which implicitly confirms their email.
 */
export async function sendSignupConfirmationEmail(input: {
  email: string
  redirectTo: string
  siteOrigin: string
}): Promise<SignupConfirmationEmailResult> {
  const email = input.email.trim().toLowerCase()
  if (!email) {
    return { ok: false, error: "Email is required." }
  }

  const admin = createAdminClient()
  if (!admin) {
    return { ok: false, skipped: "SUPABASE_SERVICE_ROLE_KEY not configured" }
  }

  const { data, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: input.redirectTo },
  })

  if (linkError) {
    console.error("[signup-confirm] generateLink:", linkError.message)
    return { ok: false, skipped: "generateLink failed" }
  }

  const confirmLink = data.properties?.action_link
  if (!confirmLink) {
    console.error("[signup-confirm] generateLink: missing action_link")
    return { ok: false, skipped: "generateLink missing action_link" }
  }

  const apiKey = getResendApiKey()
  const from = getResendFromAddress()
  if (!apiKey || !from) {
    return { ok: false, skipped: "RESEND_API_KEY or email FROM not configured" }
  }

  const resend = new Resend(apiKey)
  const { error: sendError } = await resend.emails.send({
    from,
    to: [email],
    subject: "Confirm your ZK Sports trade portal email",
    html: buildSignupConfirmationHtml(confirmLink, email, input.siteOrigin),
  })

  if (sendError) {
    return { ok: false, error: sendError.message }
  }

  return { ok: true, via: "resend" }
}
