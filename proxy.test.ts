import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "@/proxy";

describe("retention proxy routing", () => {
  it("never intercepts nested API upload routes", async () => {
    const response = await proxy(new NextRequest("https://feuille-flip.test/api/uploads/authorize"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("leaves reserved single-segment application routes alone", async () => {
    const response = await proxy(new NextRequest("https://feuille-flip.test/create"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("returns a hard, non-cacheable 404 for an invalid public slug", async () => {
    const response = await proxy(new NextRequest("https://feuille-flip.test/not_a_valid_slug"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});
