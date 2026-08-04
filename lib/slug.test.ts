import { describe, expect, it } from "vitest";

import { slugifyTitle } from "@/lib/slug";

describe("slugifyTitle", () => {
  it("turns the requested example into a clean URL", () => {
    expect(slugifyTitle("My 2026 Highlights")).toBe("my-2026-highlights");
  });

  it("normalizes punctuation, symbols, accents, and repeated separators", () => {
    expect(slugifyTitle("José's R&D: 2026!!!")).toBe("joses-r-and-d-2026");
  });

  it("removes leading and trailing punctuation", () => {
    expect(slugifyTitle("--- Hello, world? ---")).toBe("hello-world");
  });

  it("returns an empty slug for a symbols-only title", () => {
    expect(slugifyTitle("✨!!!✨")).toBe("");
  });
});

