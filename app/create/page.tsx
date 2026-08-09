import type { Metadata } from "next";

import { FlipbookEditor } from "@/components/editor/flipbook-editor";

export const metadata: Metadata = {
  title: "Create & Flip",
  description: "Design high-definition flipbook pages with local autosave.",
  alternates: { canonical: "/create" },
};

export default function CreatePage() {
  return <FlipbookEditor />;
}
