import fs from "fs"

const s = fs.readFileSync("lib/seed-data.ts", "utf8")
const start = s.indexOf("export const packages: Package[] = [")
const canada = s.indexOf("  // Canada", start)
const past = s.slice(start, canada).replace("export const packages: Package[] = ", "")

const out = `/** Past-event packages (before Canada 2026) — kept when not on live inventory sheet. */
import type { Package } from "../types/catalog"

export const pastPackages2026: Package[] = ${past}
`

fs.writeFileSync("lib/seed-data/past-packages-2026.ts", out)
console.log("Wrote past-packages-2026.ts", out.length, "bytes")
