import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { connectOffers } from "@/lib/connect";
import { namesOf } from "@/lib/members";
import { followedActors, followedIdOf, followedOf, installWatch, parseInstallLink, secretsNeeded } from "@/lib/packages";
import { requireAdmin } from "@/lib/session";
import { listDeploymentSecretNames, listPackageIndexes, listPackageInstalls, listPackages, listPackageSubscriptions, searchPackages } from "@/lib/strut/client";
import { PackagesView } from "./view";

export const metadata: Metadata = { title: "Packages" };
export const dynamic = "force-dynamic";

const warn = (what: string) => (err: unknown) => {
  console.warn(`[packages] ${what} failed: ${err instanceof Error ? err.message : String(err)}`);
  return null;
};

/**
 * Strut's packages on this box, for an admin: the installs going on (any
 * door's: this page, a proposal someone accepted, the boot list, the
 * distro), what is installed and the keys it still needs, the Software
 * card, a package from a repository and what the box follows (a bundle
 * with its parts), a search over the indexes the box follows, and those
 * indexes. The store's Install link lands here
 * (`?install=<publisher/name>&index=<key>&index_url=<url>`): it opens the
 * package's confirmation, after following its index when the box does not
 * yet, and nothing installs until the admin says so. Strut keeps all of it.
 */
export default async function PackagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireAdmin();
  const link = parseInstallLink(await searchParams);
  const [installs, installed, indexes, secretNames, found, subscriptions] = await Promise.all([
    listPackageInstalls().catch(warn("GET /packages/installs")),
    listPackages().catch(warn("GET /packages")),
    listPackageIndexes().catch(warn("GET /packages/indexes")),
    listDeploymentSecretNames().catch(warn("GET /secrets")),
    searchPackages(link?.pkg ?? "").catch(warn("GET /packages/search")),
    listPackageSubscriptions().catch(warn("GET /packages/subscriptions")),
  ]);
  const set = secretNames ? new Set(secretNames) : null;
  const followed = subscriptions ? followedOf(subscriptions, await namesOf(followedActors(subscriptions)), me.actor) : null;
  // A followed repository's install (a bundle's part's too) shows in its own row under Followed, not under Installing.
  const running = (installs ?? []).filter((i) => i.finishedAt === undefined);
  const reading = running.map((i) => followedIdOf(i.ref)).filter((id): id is string => !!id);

  return (
    <>
      <PageHeader title="Packages" />
      {installed === null || indexes === null ? (
        <p className="rounded-xl border border-dashed border-dash px-5 py-8 text-[14px] text-ink-2">
          Strut isn’t answering, so its packages can’t be read right now.
        </p>
      ) : (
        <PackagesView
          link={link}
          installing={running.filter((i) => !followedIdOf(i.ref)).map(installWatch)}
          installed={installed.map((p) => ({ ...p, needs: secretsNeeded(p, set) }))}
          secretsKnown={set !== null}
          followed={followed}
          reading={reading}
          connect={connectOffers()}
          indexes={indexes}
          initial={found}
        />
      )}
    </>
  );
}
