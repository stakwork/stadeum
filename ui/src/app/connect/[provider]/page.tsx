import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { buttonClass } from "@/components/button";
import { connectable, readAsk } from "@/lib/connect";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";

/**
 * The connect seam's confirm page (lib/connect.ts): what the person is about
 * to connect and on which box, always for themselves. Continue posts the
 * same parameters to `/api/connect/:provider` from this origin, which sends
 * them to the provider. No other page can skip it, and it can't be framed
 * (next.config.ts).
 */
export const metadata: Metadata = { title: "Connect" };
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

const toQuery = (search: Search) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) for (const one of [v].flat()) if (one !== undefined) q.append(k, one);
  return q;
};

const linkClass = "text-[14px] text-ink-3 underline hover:text-ink-2";

export default async function ConnectPage({ params, searchParams }: { params: Promise<{ provider: string }>; searchParams: Promise<Search> }) {
  const p = connectable((await params).provider);
  if (!p) notFound();
  const user = await requireUser();
  const q = toQuery(await searchParams);
  const checked = readAsk(p, q);
  const host = new URL(env.publicUrl()).host;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[400px] flex-col justify-center gap-4 px-4 py-16">
      <span className="text-[14px] text-ink-3">
        {env.orgName()} · {host}
      </span>
      <h1 className="mb-1 font-serif text-[30px] font-medium tracking-[-0.01em]">Connect {p.name}</h1>
      {checked.ok ? (
        <>
          <p className="text-[15px] text-ink-2">
            For you, {user.email}: what you run on this box will act as the {p.name} account you choose next.
          </p>
          {checked.ask.install && (
            <p className="text-[15px] text-ink-2">
              {p.name} will also install the box&rsquo;s app on an organisation or account you pick.
            </p>
          )}
          <form method="post" action={`/api/connect/${p.id}?${q}`} className="mt-2">
            <button type="submit" className={`${buttonClass.primary} h-12 w-full`}>
              Continue to {p.name}
            </button>
          </form>
          <a href={checked.ask.back} className={linkClass}>
            Back
          </a>
        </>
      ) : (
        <>
          <p role="alert" className="rounded-[10px] bg-warn-soft px-4 py-3 text-[15px]">
            {checked.message}
          </p>
          {checked.back && (
            <a href={checked.back} className={linkClass}>
              Back
            </a>
          )}
        </>
      )}
    </main>
  );
}
