import assert from "node:assert/strict"
import test from "node:test"
import { correctCompletedWord, correctProse, proseBoundary } from "../lib/browser/british-autocorrect"

test("fixes enquiry notes and common typos in British English", () => {
  assert.equal(
    correctProse(
      "New enquriy. They want a seperate paddock package, definately for sunday if the three-day is gone. Recieve the deposit tommorow.",
    ),
    "New enquiry. They want a separate paddock package, definitely for sunday if the three-day is gone. Receive the deposit tomorrow.",
  )
  assert.equal(correctProse("teh client cant make teh weekend"), "the client can't make the weekend")
  assert.equal(correctProse("alot of intrest in the color and favorite suite"), "a lot of interest in the colour and favourite suite")
})

test("leaves names, correct British spelling, and codes alone", () => {
  const note = "Spoke to Jon about Monaco. They want an organised Paddock Club weekend, travelling on Saturday."
  assert.equal(correctProse(note), note)
  assert.equal(correctProse("Gray will check the calendar"), "Gray will check the calendar")
  assert.equal(correctProse("Email matt@zk.com about the color"), "Email matt@zk.com about the colour")
  assert.equal(correctProse("e.g. the color is fine."), "e.g. the colour is fine.")
  assert.equal(correctProse("No. 4 guests want a seperate enquiry."), "No. 4 guests want a separate enquiry.")
  assert.equal(correctProse("three-day package"), "three-day package")
  for (const word of ["three", "there", "their", "board", "broad", "quite", "quiet", "cloud", "could", "form", "from", "enquiry", "enquiries", "organised", "colour"]) {
    assert.equal(correctProse(word), word, word)
  }
})

test("corrects a finished word without touching the rest of the note", () => {
  const text = "Client wants teh"
  const corrected = correctCompletedWord(text, text.length)
  assert.deepEqual(corrected, { value: "Client wants the", caret: "Client wants the".length })
  assert.equal(correctCompletedWord("seperate package", 12), null)
  assert.deepEqual(correctCompletedWord("pakcage", 7), { value: "package", caret: 7 })
  assert.equal(proseBoundary(" "), " ")
  assert.equal(proseBoundary("Enter"), "\n")
  assert.equal(proseBoundary("a"), null)
})

test("correcting twice does not keep changing the note", () => {
  const once = correctProse("becuase they recieve a seperate enquiry")
  assert.equal(once, "because they receive a separate enquiry")
  assert.equal(correctProse(once), once)
})
