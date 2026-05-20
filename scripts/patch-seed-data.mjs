import fs from "fs"

let s = fs.readFileSync("lib/seed-data.ts", "utf8")

// Fix São Paulo encoding in races
s = s.replace(/SÃ£o Paulo/g, "São Paulo")

const start = s.indexOf("export const packages: Package[] = [")
const end = s.indexOf("export const bookings: Booking[] = [")

const replacement = `import { pastPackages2026 } from "./seed-data/past-packages-2026"
import { livePackages2026 } from "./seed-data/live-packages-2026"

export const packages: Package[] = [...pastPackages2026, ...livePackages2026]

`

// Insert imports after catalog import line
if (!s.includes("past-packages-2026")) {
  s =
    s.slice(0, start) +
    replacement +
    s.slice(end)
  s = s.replace(
    'import type { Booking, Invoice, Package, Race } from "./types/catalog"\n',
    'import type { Booking, Invoice, Package, Race } from "./types/catalog"\nimport { pastPackages2026 } from "./seed-data/past-packages-2026"\nimport { livePackages2026 } from "./seed-data/live-packages-2026"\n',
  )
  // Remove duplicate imports from replacement
  s = s.replace(
    `import { pastPackages2026 } from "./seed-data/past-packages-2026"
import { livePackages2026 } from "./seed-data/live-packages-2026"

export const packages`,
    "export const packages",
  )
}

fs.writeFileSync("lib/seed-data.ts", s)
console.log("Patched seed-data.ts, new size", s.length)
