import { describe, expect, it } from "vitest";

import { dataUrlToBlob } from "@/lib/editor/encoding";

describe("editor page encoding", () => {
  it("converts a canvas data URL without making a fetch request", async () => {
    const blob = dataUrlToBlob("data:image/webp;base64,ZmV1aWxsZQ==");

    expect(blob.type).toBe("image/webp");
    expect(await blob.text()).toBe("feuille");
  });

  it("rejects malformed canvas output", () => {
    expect(() => dataUrlToBlob("blob:not-a-data-url")).toThrow(/could not be encoded/i);
  });
});
