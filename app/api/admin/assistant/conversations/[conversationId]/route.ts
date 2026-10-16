import { NextResponse } from "next/server"
import { isCmsStaff } from "@/lib/auth/permissions"
import { loadInboxThreadById } from "@/lib/assistant/inbox-load"
import { getPortalProfile } from "@/lib/supabase/profile"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const profile = await getPortalProfile()
  if (!profile || !isCmsStaff(profile)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { conversationId } = await context.params
  try {
    const thread = await loadInboxThreadById(conversationId)
    if (!thread) return NextResponse.json({ error: "Conversation not found." }, { status: 404 })
    return NextResponse.json({ ok: true, thread })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the conversation." },
      { status: 500 },
    )
  }
}
