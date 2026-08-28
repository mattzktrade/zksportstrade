import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { publicBookingFormSignError } from "../lib/booking-forms/public-errors"

describe("publicBookingFormSignError", () => {
  it("maps known RPC codes without leaking the raw message", () => {
    assert.deepEqual(publicBookingFormSignError("token expired for form 123"), {
      error: "This signing link has expired.",
      status: 410,
    })
    assert.deepEqual(publicBookingFormSignError("form is not_signable"), {
      error: "This booking form can no longer be signed.",
      status: 409,
    })
  })

  it("returns a generic error for unexpected database messages", () => {
    assert.deepEqual(publicBookingFormSignError("permission denied for table booking_forms"), {
      error: "Could not record signature.",
      status: 400,
    })
  })
})
