import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { mapSignupError, validateSignupInput } from "../lib/auth/signup"

describe("validateSignupInput", () => {
  it("accepts a complete trade access request", () => {
    const result = validateSignupInput({
      fullName: "  Alex Partner  ",
      companyName: "  Apex Travel  ",
      companyType: "travel_agency",
      email: "  Alex@Apex.travel  ",
      password: "longenough",
    })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.fullName, "Alex Partner")
      assert.equal(result.value.companyName, "Apex Travel")
      assert.equal(result.value.email, "alex@apex.travel")
      assert.equal(result.value.companyType, "travel_agency")
    }
  })

  it("rejects missing fields and short passwords", () => {
    assert.equal(
      validateSignupInput({
        fullName: "",
        companyName: "Apex",
        companyType: "other",
        email: "a@b.co",
        password: "longenough",
      }).ok,
      false,
    )
    assert.equal(
      validateSignupInput({
        fullName: "Alex",
        companyName: "Apex",
        companyType: "not-a-type",
        email: "a@b.co",
        password: "longenough",
      }).ok,
      false,
    )
    assert.equal(
      validateSignupInput({
        fullName: "Alex",
        companyName: "Apex",
        companyType: "other",
        email: "a@b.co",
        password: "short",
      }).ok,
      false,
    )
    assert.equal(
      validateSignupInput({
        fullName: "A".repeat(201),
        companyName: "Apex",
        companyType: "other",
        email: "a@b.co",
        password: "longenough",
      }).ok,
      false,
    )
  })
})

describe("mapSignupError", () => {
  it("replaces Supabase rate-limit errors with launch-safe copy", () => {
    assert.match(mapSignupError("email rate limit exceeded"), /a lot of registrations/)
    assert.match(mapSignupError("Too Many Requests"), /a lot of registrations/)
  })

  it("passes other messages through", () => {
    assert.equal(mapSignupError("User already registered"), "User already registered")
  })
})
