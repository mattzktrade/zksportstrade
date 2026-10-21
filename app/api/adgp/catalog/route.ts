import { NextResponse } from "next/server"
import { verifyAdgpApiSecret } from "@/lib/integrations/adgp/auth"
import { loadAdgpCatalog } from "@/lib/integrations/adgp/catalog"
import { getAdgpConfig } from "@/lib/integrations/adgp/config"

export async function GET(request: Request) {
  const config = getAdgpConfig()
  if (!config) {
    return NextResponse.json({ error: "ADGP API is not configured" }, { status: 503 })
  }
  if (!verifyAdgpApiSecret(request, config.apiSecret)) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 })
  }

  try {
    const catalog = await loadAdgpCatalog()
    if (!catalog.ok) {
      return NextResponse.json({ error: catalog.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, packages: catalog.items })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Catalog failed"
    console.error("[adgp catalog]", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
