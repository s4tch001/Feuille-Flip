import { describe, expect, it } from "vitest";

import {
  canTurnViewerSpread,
  createViewerPageOrder,
  resolveViewerInitPageIndex,
  resolveViewerPageIndex,
} from "@/lib/viewer-page-order";

describe("viewer page order", () => {
  it("keeps even page counts unchanged", () => {
    expect(createViewerPageOrder(2)).toEqual([1, 2]);
    expect(createViewerPageOrder(4)).toEqual([1, 2, 3, 4]);
  });

  it("places an invisible endpaper before an odd final cover", () => {
    expect(createViewerPageOrder(3)).toEqual([1, 2, null, 3]);
    expect(createViewerPageOrder(5)).toEqual([1, 2, 3, 4, null, 5]);
  });

  it("does not create an invisible stop in single-page mode", () => {
    expect(createViewerPageOrder(5, "single")).toEqual([1, 2, 3, 4, 5]);
  });

  it("preserves a right-hand page when switching between single and spread layouts", () => {
    const spreadOrder = createViewerPageOrder(5, "spread");
    const singleOrder = createViewerPageOrder(5, "single");

    expect(resolveViewerPageIndex(spreadOrder, [1, 2], 3)).toBe(2);
    expect(resolveViewerPageIndex(singleOrder, [2], 3)).toBe(2);
    expect(resolveViewerPageIndex(spreadOrder, [5], 5)).toBe(5);
  });

  it("uses the requested init index even if an early flip event reported the spread start", () => {
    const spreadOrder = createViewerPageOrder(5, "spread");
    const pageFromEarlyFlipEvent = 2;

    expect(resolveViewerInitPageIndex(spreadOrder, [1, 2], 2, pageFromEarlyFlipEvent)).toBe(2);
  });

  it("falls back to the visible spread when the requested page is unavailable", () => {
    expect(resolveViewerPageIndex([1, 2, 3], [1, 2], 99)).toBe(1);
    expect(resolveViewerPageIndex([1], undefined, 1)).toBe(0);
  });

  it("does not add a spacer to a one-page flipbook or invalid counts", () => {
    expect(createViewerPageOrder(1)).toEqual([1]);
    expect(createViewerPageOrder(0)).toEqual([]);
    expect(createViewerPageOrder(2.5)).toEqual([]);
  });

  it("blocks outward turns at the first and last spreads", () => {
    expect(canTurnViewerSpread("previous", 0, 4)).toBe(false);
    expect(canTurnViewerSpread("next", 0, 4)).toBe(true);
    expect(canTurnViewerSpread("previous", 3, 4)).toBe(true);
    expect(canTurnViewerSpread("next", 3, 4)).toBe(false);
  });
});
