export type ViewerPageNumber = number | null;
export type ViewerTurnDirection = "previous" | "next";
export type ViewerPageLayout = "single" | "spread";

/**
 * `showCover` needs an even number of DOM pages so both covers can be single
 * hard pages. For an odd source count, the invisible endpaper belongs before
 * the real last page; otherwise the endpaper itself becomes the back cover.
 */
export function createViewerPageOrder(
  pageCount: number,
  layout: ViewerPageLayout = "spread",
): ViewerPageNumber[] {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) return [];

  const pages: ViewerPageNumber[] = Array.from({ length: pageCount }, (_, index) => index + 1);
  if (layout === "spread" && pageCount > 1 && pageCount % 2 === 1) pages.splice(pages.length - 1, 0, null);
  return pages;
}

export function canTurnViewerSpread(
  direction: ViewerTurnDirection,
  currentSpreadIndex: number,
  spreadCount: number,
): boolean {
  if (!Number.isSafeInteger(currentSpreadIndex) || !Number.isSafeInteger(spreadCount) || spreadCount < 1) return false;
  return direction === "previous"
    ? currentSpreadIndex > 0
    : currentSpreadIndex < spreadCount - 1;
}

/** Keep the requested logical page when a responsive remount selects its spread. */
export function resolveViewerPageIndex(
  pageOrder: readonly ViewerPageNumber[],
  spread: readonly number[] | undefined,
  requestedPage: number,
): number {
  const requestedIndex = pageOrder.indexOf(requestedPage);
  if (requestedIndex >= 0 && spread?.includes(requestedIndex)) return requestedIndex;
  return spread?.[0] ?? 0;
}

/** Prefer PageFlip's requested start index because its early `flip` event can be stale. */
export function resolveViewerInitPageIndex(
  pageOrder: readonly ViewerPageNumber[],
  spread: readonly number[] | undefined,
  requestedBookPage: number,
  fallbackPage: number,
): number {
  const requestedPage = pageOrder[requestedBookPage] ?? fallbackPage;
  return resolveViewerPageIndex(pageOrder, spread, requestedPage);
}
