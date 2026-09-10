/**
 * Deterministic current-page from scroll geometry (uniform page size).
 * The page whose band contains the reference line (40% down the viewport)
 * is "current" — stable across zoom, resize and layout changes.
 */
export function pageFromScroll(
  scrollTop: number,
  viewportHeight: number,
  pageHeight: number,
  gap: number,
  pageCount: number,
): number {
  if (pageHeight <= 0 || pageCount <= 0) return 1
  const ref = scrollTop + viewportHeight * 0.4
  const n = Math.floor(ref / (pageHeight + gap)) + 1
  return Math.min(pageCount, Math.max(1, n))
}

/** scrollTop that puts page n at the top of the viewport */
export function scrollTopForPage(page: number, pageHeight: number, gap: number, pageCount: number): number {
  const clamped = Math.min(pageCount, Math.max(1, page))
  return (clamped - 1) * (pageHeight + gap)
}
