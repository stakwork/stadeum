import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/session";
import { BrandUnsupportedError, getBrand, type StrutBrand } from "@/lib/strut/client";
import { BrandForm } from "./forms";

export const metadata: Metadata = { title: "Branding" };
export const dynamic = "force-dynamic";

/**
 * The look of every strut app on the box: one color, the corners and the
 * font. Strut keeps the brand (`GET /brand`, `PUT /brand`) and hands it to
 * every app page it hosts; stadeum keeps no copy.
 */
export default async function BrandingPage() {
  await requireAdmin();
  const read: { brand: StrutBrand } | { problem: string } = await getBrand().catch((err: unknown) => {
    if (err instanceof BrandUnsupportedError) {
      return { problem: "Strut on this box is older than branding. Once it updates, the brand is set here." };
    }
    console.warn(`[branding] GET /brand failed: ${err instanceof Error ? err.message : String(err)}`);
    return { problem: "Strut isn’t answering, so the brand can’t be read right now." };
  });

  return (
    <>
      <PageHeader title="Branding" />
      {"problem" in read ? (
        <p className="rounded-xl border border-dashed border-dash px-5 py-8 text-[14px] text-ink-2">{read.problem}</p>
      ) : (
        <BrandForm saved={read.brand} />
      )}
    </>
  );
}
