export const APP_SEARCH_PAGE = "page"
export const APP_SEARCH_HEADER = "header"

/** Spread onto the primary list/page search field so ⌘K / Ctrl+K can find it. */
export const pageSearchProps = {
  "data-app-search": APP_SEARCH_PAGE,
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
} as const

/** Spread onto the admin header jump search. */
export const headerSearchProps = {
  "data-app-search": APP_SEARCH_HEADER,
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
} as const

export const escapeCloseProps = {
  "data-escape-close": "",
} as const

export function usesAppleModifier(nav: { platform?: string; userAgent?: string }): boolean {
  const platform = nav.platform ?? ""
  const userAgent = nav.userAgent ?? ""
  return /Mac|iPhone|iPad|iPod/.test(platform) || /Mac OS X|Macintosh|iPhone|iPad/.test(userAgent)
}

export function applyPlatformDataset(
  doc: { documentElement: { dataset: DOMStringMap } } = document,
  nav: { platform?: string; userAgent?: string } = navigator,
) {
  doc.documentElement.dataset.platform = usesAppleModifier(nav) ? "mac" : "other"
}

export function isModifiedClick(event: { metaKey: boolean; ctrlKey: boolean; button?: number }): boolean {
  return event.metaKey || event.ctrlKey || event.button === 1
}

export function openInNewTab(href: string) {
  window.open(href, "_blank", "noopener,noreferrer")
}

export function blurWheelableControl(el: Element | null) {
  if (el instanceof HTMLSelectElement) {
    el.blur()
    return
  }
  if (!(el instanceof HTMLInputElement)) return
  if (el.type !== "number" && el.type !== "range") return
  el.blur()
}

export function setNativeInputValue(el: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
  descriptor?.set?.call(el, value)
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

export function isVisibleInput(el: HTMLInputElement) {
  if (el.disabled) return false
  return el.getClientRects().length > 0
}

export function findBestSearchInput(root: ParentNode = document): HTMLInputElement | null {
  const all = [...root.querySelectorAll<HTMLInputElement>("input[data-app-search]")].filter(isVisibleInput)
  if (all.length === 0) return null

  const dialog = root.querySelector("[data-escape-close], [role='dialog']")
  if (dialog) {
    const inDialog = all.filter((el) => dialog.contains(el) || el.closest("[data-escape-close], [role='dialog']"))
    return inDialog[0] ?? null
  }

  const page = all.filter((el) => el.dataset.appSearch === APP_SEARCH_PAGE)
  return (page[0] ?? all[0]) ?? null
}

export function filterByQuery<T extends { label: string; href: string; keywords?: string }>(
  items: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((item) =>
    [item.label, item.href, item.keywords ?? ""].some((value) => value.toLowerCase().includes(q)),
  )
}

export function shouldIgnoreCommandK(target: EventTarget | null) {
  if (target == null) return false
  if (typeof HTMLTextAreaElement !== "undefined" && target instanceof HTMLTextAreaElement) return true
  if (typeof HTMLElement !== "undefined" && target instanceof HTMLElement && target.isContentEditable) return true
  return false
}
