export type ViewerPageNumber = number | null;
export type ViewerPageLayout = "single" | "spread";
export type ViewerBookPose = "front" | "open" | "back";

/**
 * `showCover` needs an even number of DOM pages so both covers can be single
 * hard pages. For an odd source count above two, the white blank page belongs
 * before the real last page so the real last page remains the back cover.
 */
export function createViewerPageOrder(
  pageCount: number,
  layout: ViewerPageLayout = "spread",
): ViewerPageNumber[] {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) return [];

  const pages: ViewerPageNumber[] = Array.from({ length: pageCount }, (_, index) => index + 1);
  if (layout === "spread" && pageCount > 2 && pageCount % 2 === 1) pages.splice(pages.length - 1, 0, null);
  return pages;
}

export function getViewerBookPose(currentBookPage: number, bookPageCount: number): ViewerBookPose {
  if (currentBookPage <= 0 || bookPageCount <= 1) return "front";
  if (currentBookPage >= bookPageCount - 1) return "back";
  return "open";
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
