import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import {
  blankContractContent,
  contractLinkExpired,
  contractSendError,
  contractStatusLabel,
  normalizeContractDraft,
  syHoldingsContractContent,
  syHoldingsContractTitle,
} from "../lib/contracts/content"
import { contractContentHash } from "../lib/contracts/hash"
import { generateInclusionContractPdf } from "../lib/contracts/pdf"

const sampleContent = {
  ...blankContractContent(),
  event: "Singapore Grand Prix",
  dates: "10 October 2026",
  guestAllocation: "Up to 20 guests",
  sections: [{ id: "a", heading: "Access", bullets: ["Private terrace"] }],
}

describe("inclusion contracts", () => {
  it("drops empty points and refuses to send without a recipient", () => {
    const draft = normalizeContractDraft({
      title: "  Weekend contract  ",
      companyName: "Example Ltd",
      clientName: "",
      clientEmail: "not-an-email",
      content: {
        ...blankContractContent(),
        event: "Singapore",
        dates: "10 October 2026",
        sections: [
          { id: "a", heading: "Access", bullets: ["  Gate A  ", " "] },
          { id: "b", heading: "", bullets: [" ", ""] },
        ],
      },
    })
    assert.equal(draft.title, "Weekend contract")
    assert.deepEqual(draft.content.sections, [{ id: "a", heading: "Access", bullets: ["Gate A"] }])
    assert.equal(contractSendError(draft), "Add the person who should receive the contract.")
  })

  it("labels an expired signing link without treating it as signed", () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    assert.equal(contractLinkExpired("sent", past), true)
    assert.equal(contractLinkExpired("signed", past), false)
    assert.equal(contractStatusLabel("sent", past), "Link expired")
    assert.equal(contractStatusLabel("signed", past), "Signed")
  })

  it("changes the signed hash when the contract copy changes", () => {
    const base = {
      title: "Weekend contract",
      companyName: "Example Ltd",
      clientName: "Alex",
      clientEmail: "alex@example.com",
      content: sampleContent,
    }
    const changed = {
      ...base,
      content: {
        ...base.content,
        guestAllocation: "Up to 10 guests",
      },
    }
    assert.notEqual(contractContentHash(base), contractContentHash(changed))
  })

  it("renders a PDF without reserving stock", async () => {
    const bytes = await generateInclusionContractPdf({
      documentRef: "INC-TEST",
      draft: {
        title: "Weekend contract",
        companyName: "Example Ltd",
        clientName: "Alex",
        clientEmail: "alex@example.com",
        content: sampleContent,
      },
    })
    assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("utf8"), "%PDF-")
    const source = readFileSync("app/(admin)/admin/contracts/actions.ts", "utf8")
    assert.equal(source.includes("inventory-sync"), false)
    assert.equal(source.includes("syncBookingFormDealInventory"), false)
  })

  it("lets a signer draw or type a signature", () => {
    const capture = readFileSync("components/signature-capture.tsx", "utf8")
    assert.match(capture, /mode === "draw"/)
    assert.match(capture, /mode === "type"/)
    assert.match(capture, /Type your signature/)
    const contractSign = readFileSync("app/sign/contract/[token]/signing-client.tsx", "utf8")
    assert.match(contractSign, /SignatureCapture/)
    assert.match(contractSign, /BILL TO:/)
    assert.match(contractSign, /Contract N°/)
    const bookingSign = readFileSync("app/sign/booking/[token]/signing-client.tsx", "utf8")
    assert.match(bookingSign, /SignatureCapture/)
    const editor = readFileSync("app/(admin)/admin/contracts/contract-editor.tsx", "utf8")
    assert.match(editor, /CrmPartySelect/)
    assert.match(editor, /createCrmAccount/)
    const pdf = readFileSync("lib/contracts/pdf.ts", "utf8")
    assert.match(pdf, /BILL TO:/)
    assert.match(pdf, /Contract No/)
    assert.match(pdf, /BOOKING_SELLER/)
  })

  it("keeps the SY Holdings starting template", async () => {
    const content = syHoldingsContractContent()
    assert.equal(syHoldingsContractTitle(), "SY HOLDINGS – BOOKING INCLUSIONS")
    assert.match(content.event, /Velocity Terrace/)
    assert.equal(content.sections.length, 7)
    const newPage = readFileSync("app/(admin)/admin/contracts/new/page.tsx", "utf8")
    assert.match(newPage, /template=sy/)
    assert.match(newPage, /syHoldingsContractContent/)
    assert.match(newPage, /Blank contract/)
    const bytes = await generateInclusionContractPdf({
      documentRef: "INC-SY",
      draft: {
        title: syHoldingsContractTitle(),
        companyName: "SY Holdings",
        clientName: "Darrell",
        clientEmail: "darrell@example.com",
        content,
      },
    })
    assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("utf8"), "%PDF-")
  })
})
