import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const placeOrder = readFileSync(
  new URL(
    "../supabase/migrations/20260715120000_prefer_single_source_cost_allocate.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase()
const trustedCommit = readFileSync(
  new URL(
    "../supabase/migrations/20260828120000_portal_place_order_trusted_commit.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase()
const checkoutActions = readFileSync(
  new URL("../app/(portal)/checkout/actions.ts", import.meta.url),
  "utf8",
)
const placeOrderErrors = readFileSync(
  new URL("../lib/orders/place-order-errors.ts", import.meta.url),
  "utf8",
).toLowerCase()

test("portal checkout places the order as the signed-in agent, not on behalf of another agent", () => {
  assert.match(checkoutActions, /rpc\("place_order"/)
  assert.doesNotMatch(checkoutActions, /p_agent_profile_id/)
  assert.match(placeOrder, /create or replace function public\.place_order\(/)
  assert.match(placeOrder, /elsif p_agent_profile_id is not null then/)
  assert.match(placeOrder, /if not public\.is_admin\(\) then\s+raise exception 'forbidden'/)
  assert.match(placeOrder, /else\s+v_uid := v_caller/)
  assert.match(placeOrder, /perform public\.allocate_order_cost_layers/)
})

test("order-entry allocation is a trusted commit and agents cannot call it directly", () => {
  assert.match(trustedCommit, /create or replace function public\.inventory_caller_may_mutate/)
  assert.match(trustedCommit, /inventory\.trusted_commit/)
  assert.match(
    trustedCommit,
    /create or replace function public\.allocate_order_cost_layers/,
  )
  assert.match(
    trustedCommit,
    /perform set_config\('inventory\.trusted_commit', 'on', true\)/,
  )
  assert.match(
    trustedCommit,
    /perform public\.inventory_allocate_quantity\(/,
  )
  assert.match(
    trustedCommit,
    /revoke all on function public\.allocate_order_cost_layers\(uuid, text, int, text\)\s+from authenticated/,
  )
  assert.match(
    trustedCommit,
    /if not public\.inventory_caller_may_mutate\(\) then\s+raise exception 'forbidden'/,
  )
  assert.doesNotMatch(
    trustedCommit,
    /grant execute on function public\.allocate_order_cost_layers\(uuid, text, int, text\)\s+to authenticated/,
  )
  assert.match(trustedCommit, /coalesce\(/)
  assert.match(trustedCommit, /auth\.role\(\) is not distinct from 'service_role'/)
})

test("checkout maps purchased-stock allocator failures instead of a generic booking error", () => {
  assert.match(placeOrderErrors, /insufficient_purchased/)
  assert.match(placeOrderErrors, /insufficient_canonical_day_capacity/)
})
