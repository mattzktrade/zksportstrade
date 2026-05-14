import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

/**
 * Vercel Cron (see vercel.json): releases inventory holds past `expires_at`.
 * Set env CRON_SECRET to a long random string; Vercel Cron sends Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 503 })
  }
  const auth = request.headers.get("authorization")
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json({ ok: false, error: "Supabase URL or service role key missing." }, { status: 503 })
  }

  const supabase = createClient(url, serviceKey)
  const { data, error } = await supabase.rpc("release_expired_inventory_holds")

  if (error) {
    console.error("[cron/release-expired-holds]", error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const released = typeof data === "number" ? data : Number(data)
  return NextResponse.json({ ok: true, released: Number.isFinite(released) ? released : 0 })
}
