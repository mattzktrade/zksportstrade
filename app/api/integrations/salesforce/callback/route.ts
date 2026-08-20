import { NextResponse } from "next/server"

/** Salesforce OAuth is retired. */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin
  return NextResponse.redirect(`${origin}/admin/settings?tab=integrations`)
}
