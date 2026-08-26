import dotenv from "dotenv"
import { createAdminClient } from "../lib/supabase/admin"

dotenv.config({ path: ".env.local" })

async function main() {
  const packageId = process.env.INVENTORY_TEST_PACKAGE_ID?.trim()
  if (!packageId) {
    throw new Error(
      "INVENTORY_TEST_PACKAGE_ID must identify a dedicated staging product whose stock may be temporarily reserved.",
    )
  }
  const admin = createAdminClient()
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.")

  const { data: availability, error: availabilityError } = await admin
    .from("inventory_availability")
    .select("available_quantity")
    .eq("package_id", packageId)
    .single()
  if (availabilityError) throw availabilityError
  const quantity = Number(availability.available_quantity ?? 0)
  if (quantity <= 0) throw new Error("The test product needs at least one available purchased unit.")

  const runId = crypto.randomUUID()
  const firstKey = `concurrency-test:${runId}:first`
  const secondKey = `concurrency-test:${runId}:second`
  const allocate = (requestKey: string) =>
    admin.rpc("inventory_allocate_quantity", {
      p_package_id: packageId,
      p_quantity: quantity,
      p_state: "reserved",
      p_source: "concurrency_integration_test",
      p_request_key: requestKey,
      p_reason: "Concurrent last-capacity integration test",
      p_metadata: { integration_test: true, run_id: runId },
    })

  const results = await Promise.all([allocate(firstKey), allocate(secondKey)])
  const winners = results.filter((result) => !result.error)
  const losers = results.filter((result) => result.error)
  const winningKey = results[0].error ? secondKey : firstKey

  try {
    if (winners.length !== 1 || losers.length !== 1) {
      throw new Error(
        `Expected one success and one rejection; received ${winners.length} success(es) and ${losers.length} rejection(s).`,
      )
    }
    if (
      !/insufficient_(purchased_stock|purchased_day_capacity)/i.test(
        losers[0].error?.message ?? "",
      )
    ) {
      throw new Error(`Unexpected losing error: ${losers[0].error?.message}`)
    }

    const retry = await allocate(winningKey)
    if (retry.error || Number(retry.data) !== quantity) {
      throw new Error(`Idempotent retry failed: ${retry.error?.message ?? String(retry.data)}`)
    }
    const { count, error: countError } = await admin
      .from("inventory_allocations")
      .select("id", { count: "exact", head: true })
      .eq("request_key", winningKey)
      .eq("state", "reserved")
    if (countError) throw countError
    if (!count || count < 1) throw new Error("Winning reservation was not persisted.")

    console.log(
      JSON.stringify(
        {
          packageId,
          testedQuantity: quantity,
          concurrentSuccesses: winners.length,
          concurrentRejections: losers.length,
          idempotentRetry: true,
        },
        null,
        2,
      ),
    )
  } finally {
    await admin.rpc("inventory_release_allocations", {
      p_request_key: winningKey,
      p_reason: "Concurrency integration test cleanup",
      p_allow_committed: false,
    })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
