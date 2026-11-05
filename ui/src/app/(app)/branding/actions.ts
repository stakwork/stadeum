"use server";

import { requireAdmin } from "@/lib/session";
import { putBrand, StrutHttpError, type StrutBrand } from "@/lib/strut/client";

/** What strut kept, or its refusal in its own words. */
export type SaveResult = { brand: StrutBrand; error?: never } | { error: string; brand?: never };

/**
 * `PUT /brand` with the deployment key: the whole brand, so `{}` resets it.
 * Strut checks every field; a refusal changes nothing.
 */
export async function saveBrand(brand: StrutBrand): Promise<SaveResult> {
  await requireAdmin();
  try {
    return { brand: (await putBrand(brand && typeof brand === "object" ? brand : {})).brand };
  } catch (err) {
    if (err instanceof StrutHttpError) return { error: err.detail ?? `Strut answered ${err.status}. Nothing changed.` };
    return { error: "Strut isn’t answering. Nothing changed." };
  }
}
