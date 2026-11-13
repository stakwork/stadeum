import type { Metadata } from "next";

import { PageHeader, SectionLabel } from "@/components/page-header";
import { modelsView, type ModelsView } from "@/lib/models/apply";
import { requireAdmin } from "@/lib/session";
import { ModelsForm, Providers } from "./forms";

export const metadata: Metadata = { title: "Models" };
export const dynamic = "force-dynamic";

const note = "rounded-xl border border-dashed border-dash px-5 py-8 text-[14px] text-ink-2";

/**
 * The providers this workspace calls and the models people may use
 * (docs/models.md). A key goes to the gateway and stays there; the list and
 * the default go to every person's key in the gateway and to strut, where
 * Jamie offers them.
 */
export default async function ModelsPage() {
  await requireAdmin();
  const view: ModelsView | null = await modelsView().catch((err: unknown) => {
    console.warn(`[models] page read failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });

  return (
    <>
      <PageHeader title="Models" />
      {!view ? (
        <p className={note}>The gateway isn&rsquo;t answering, so the providers can&rsquo;t be read right now.</p>
      ) : (
        <>
          <section aria-labelledby="providers" className="flex flex-col gap-3">
            <SectionLabel id="providers">Providers</SectionLabel>
            <Providers providers={view.providers} />
            <p className="text-[13px] text-ink-3">
              A key you set is kept in the gateway and nowhere else. Every call goes through it, on the caller&rsquo;s own spending cap.
            </p>
          </section>

          <section aria-labelledby="models" className="flex flex-col gap-3">
            <SectionLabel id="models">Models</SectionLabel>
            {!view.groups ? (
              <p className={note}>Strut isn&rsquo;t answering, so its models can&rsquo;t be read right now.</p>
            ) : view.groups.length === 0 ? (
              <p className={note}>Set a provider&rsquo;s key above, and its models show here.</p>
            ) : (
              <>
                <p className="text-[14px] text-ink-2">
                  People pick from the allowed models in Jamie. The default is what everyone gets unless they pick, and what
                  workflows with no model of their own run on.
                </p>
                <ModelsForm groups={view.groups.map((g) => ({ label: g.provider.label, prefix: g.provider.strut, models: g.models }))} />
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
