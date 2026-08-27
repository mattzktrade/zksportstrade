import type { SupabaseClient } from "@supabase/supabase-js"

const TOKEN_EVENT = "signing_token_issued"

function missingSigningTokenColumn(message: string): boolean {
  return /client_signing_token/i.test(message)
}

export async function saveBookingFormSigningToken(
  client: SupabaseClient,
  formId: string,
  token: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (token) {
    const payload = { ...extra, client_signing_token: token }
    const { error } = await client.from("booking_forms").update(payload).eq("id", formId)
    if (error) {
      if (!missingSigningTokenColumn(error.message)) {
        throw new Error(error.message)
      }
      if (Object.keys(extra).length) {
        const { error: fallback } = await client.from("booking_forms").update(extra).eq("id", formId)
        if (fallback) throw new Error(fallback.message)
      }
    }
    const { error: eventError } = await client.from("booking_form_events").insert({
      booking_form_id: formId,
      event_type: TOKEN_EVENT,
      metadata: { token },
    })
    if (eventError) {
      console.warn("[booking-forms] could not record signing token event:", eventError.message)
    }
    return
  }

  if (!Object.keys(extra).length) return
  const { error } = await client.from("booking_forms").update(extra).eq("id", formId)
  if (error) throw new Error(error.message)
}

export async function readBookingFormSigningToken(
  client: SupabaseClient,
  formId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("booking_forms")
    .select("client_signing_token")
    .eq("id", formId)
    .maybeSingle()
  if (!error) {
    const token = String(data?.client_signing_token ?? "").trim()
    if (token) return token
  } else if (!missingSigningTokenColumn(error.message)) {
    throw new Error(error.message)
  }

  const { data: events, error: eventError } = await client
    .from("booking_form_events")
    .select("metadata")
    .eq("booking_form_id", formId)
    .eq("event_type", TOKEN_EVENT)
    .order("created_at", { ascending: false })
    .limit(1)
  if (eventError) {
    console.warn("[booking-forms] could not read signing token event:", eventError.message)
    return null
  }
  const token = String((events?.[0]?.metadata as { token?: string } | null)?.token ?? "").trim()
  return token || null
}
