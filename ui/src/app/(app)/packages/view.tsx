"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { buttonClass } from "@/components/button";
import { fieldClass } from "@/components/form";
import { SectionLabel } from "@/components/page-header";
import { Dot } from "@/components/state";
import { relativeTime } from "@/lib/format";
import {
  boxSecrets,
  bringsWords,
  canWords,
  connectFor,
  connectHref,
  explainRefusal,
  followedBySource,
  followedFrom,
  followedState,
  hitSecrets,
  hostOf,
  itemsByKind,
  linkIndexState,
  parseRepositoryRef,
  refusalCode,
  repoConnectFor,
  repoEdits,
  repoWhere,
  shortKey,
  shortName,
  SOFTWARE_REF,
  SOFTWARE_WORDS,
  softwareOf,
  type ConnectOffer,
  type Followed,
  type InstallLink,
  type InstallWatch,
} from "@/lib/packages";
import type { InstalledPackage, PackageHit, PackageIndex, PackageRepo, PackageRepoCommit, PackageRepoDiff, UninstallResult } from "@/lib/strut/client";
import {
  checkFollowed,
  closeRepo,
  commitRepo,
  editRepository,
  findPackages,
  followedProgress,
  followIndex,
  followRepository,
  install,
  installFromRepository,
  pullRepo,
  repoChanges,
  setSecret,
  uninstall,
  unfollow,
  unfollowIndex,
} from "./actions";
import { InstallBar, Installing, useInstallWatch } from "./install-progress";

type Installed = InstalledPackage & { needs: string[] };
/** Followed from this page: what strut answered, and the read it started (`n`: which follow it was). */
type Started = { f: Followed; n: number; before?: string };
type Found = { hits: PackageHit[]; errors: Array<{ index: string; error: string }> };

const card = "rounded-xl border border-rule bg-surface";
const small =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-rule-strong bg-surface px-3 text-[13px] font-medium text-ink transition-colors duration-150 hover:border-ink-3 disabled:pointer-events-none disabled:opacity-50";
const empty = "rounded-xl border border-dashed border-dash px-5 py-6 text-[14px] text-ink-2";

/**
 * The page: the store's link when it brought the admin here, the installs
 * going on, what is installed, a package from a repository, what the box
 * follows and what is edited here, a search over the indexes, and the
 * indexes. Install and Uninstall each ask first; the link only ever opens
 * the question.
 */
export function PackagesView(props: {
  link: InstallLink | null;
  installing: InstallWatch[];
  installed: Installed[];
  secretsKnown: boolean;
  /** What the box follows; null when strut couldn't say. */
  followed: Followed[] | null;
  /** The ones strut is installing a release of now. */
  reading: string[];
  /** The packages opened here as git repos, to change here and commit back. */
  editing: PackageRepo[];
  /** The accounts a person can connect here, for a repository strut couldn't read. */
  connect: ConnectOffer[];
  indexes: PackageIndex[];
  initial: Found | null;
}) {
  const { link, installed, indexes } = props;
  // Followed here and not yet in the page's reading of strut, each with the read it started;
  // stopped here, and gone from it; and the row the Software card asked to stop (`n`: which ask).
  const [followedNow, setFollowedNow] = useState<Started[]>([]);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [stopAsk, setStopAsk] = useState<{ id: string; n: number } | null>(null);
  const known = new Set((props.followed ?? []).map((f) => f.id));
  const followed =
    props.followed && [...props.followed, ...followedNow.filter((s) => !known.has(s.f.id)).map((s) => s.f)].filter((f) => !gone.has(f.id));
  const onFollowed = (f: Followed, before?: string) => {
    setFollowedNow((now) => [...now.filter((x) => x.f.id !== f.id), { f, n: now.length + 1, ...(before ? { before } : {}) }]);
    setGone((now) => {
      const next = new Set(now);
      next.delete(f.id);
      return next;
    });
  };
  // Opened here and not yet in the page's reading of strut; closed here, and gone from it.
  const [openedNow, setOpenedNow] = useState<PackageRepo[]>([]);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const open = new Set(props.editing.map((r) => r.package));
  const editing = [...props.editing, ...openedNow.filter((r) => !open.has(r.package))].filter((r) => !closed.has(r.package));
  const onEdited = (r: PackageRepo) => {
    setOpenedNow((now) => [...now.filter((x) => x.package !== r.package), r]);
    setClosed((now) => {
      const next = new Set(now);
      next.delete(r.package);
      return next;
    });
  };
  const byName = useMemo(() => new Map(installed.map((p) => [p.package, p])), [installed]);
  const indexLabel = (id: string) => indexes.find((i) => i.id === id)?.label ?? id;

  // The link's package, as the indexes list it: from the link's index when it names one.
  const linkState = link?.index ? linkIndexState(link.index, indexes) : null;
  const linkHit = (found: Found | null) =>
    link ? found?.hits.find((h) => h.package === link.pkg && (linkState?.state !== "followed" || h.index === linkState.id)) : undefined;
  const opensAtOnce = !!link && (!link.index || linkState?.state === "followed") && !byName.has(link.pkg);
  const [reviewing, setReviewing] = useState<PackageHit | null>(() => (opensAtOnce ? (linkHit(props.initial) ?? null) : null));
  const [found, setFound] = useState<Found | null>(props.initial);

  // The installs this page follows: those strut was running when the page
  // was read (again after each install ends), and one whose dialog was
  // closed before it ended. Each stays until dismissed.
  const [following, setFollowing] = useState<InstallWatch[]>(props.installing);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [inDialog, setInDialog] = useState<string | null>(null);
  useEffect(() => {
    setFollowing((now) => [...now, ...props.installing.filter((w) => !now.some((f) => f.id === w.id))]);
  }, [props.installing]);
  const follow = (w: InstallWatch) => setFollowing((now) => [...now.filter((f) => f.id !== w.id), w]);

  return (
    <>
      {link && (
        <StoreLink
          link={link}
          state={linkState}
          installed={byName.get(link.pkg)}
          hit={linkHit(found)}
          searched={found !== null}
          follows={indexes.length > 0}
          onFollowed={async (index) => {
            const r = await findPackages(link.pkg);
            if ("error" in r) return r.error;
            setFound(r);
            const hit = r.hits.find((h) => h.package === link.pkg && h.index === index);
            if (!hit) return `Followed. ${index} doesn’t list ${link.pkg} yet.`;
            if (!byName.has(link.pkg)) setReviewing(hit);
            return undefined;
          }}
          onReview={setReviewing}
        />
      )}

      <Installing
        installs={following.filter((w) => w.id !== inDialog && !dismissed.has(w.id))}
        onDismiss={(id) => setDismissed((now) => new Set(now).add(id))}
      />

      <InstalledList installed={installed} secretsKnown={props.secretsKnown} followed={props.followed ?? []} editing={editing} />

      {followed && <SoftwareCard software={softwareOf(followed)} onFollowed={onFollowed} onRemove={(id) => setStopAsk((now) => ({ id, n: (now?.n ?? 0) + 1 }))} />}

      <FromRepository connect={props.connect} onFollowed={onFollowed} onEdited={onEdited} />

      <FollowedList
        followed={followed}
        reading={props.reading}
        started={followedNow}
        connect={props.connect}
        ask={stopAsk}
        onGone={(id) => setGone((now) => new Set(now).add(id))}
      />

      <EditingList repos={editing} connect={props.connect} onClosed={(pkg) => setClosed((now) => new Set(now).add(pkg))} />

      <Find
        initialQuery={link?.pkg ?? ""}
        found={found}
        onFound={setFound}
        installed={byName}
        indexLabel={indexLabel}
        follows={indexes.length > 0}
        onInstall={setReviewing}
      />

      <Indexes indexes={indexes} />

      {reviewing && (
        <InstallDialog
          key={`${reviewing.index}:${reviewing.package}`}
          hit={reviewing}
          indexLabel={indexLabel(reviewing.index)}
          installed={byName.get(reviewing.package)}
          onStarted={setInDialog}
          onClose={(going) => {
            if (going) follow(going);
            setInDialog(null);
            setReviewing(null);
          }}
        />
      )}
    </>
  );
}

// ── the store's link ────────────────────────────────────────────────────

/**
 * What the store's Install link asked for. When the box does not follow
 * the link's index, following it comes first, with its key shown: the key
 * is what names are checked against from then on. A key filed under the
 * same address already is never replaced from a link.
 */
function StoreLink(props: {
  link: InstallLink;
  state: ReturnType<typeof linkIndexState> | null;
  installed: Installed | undefined;
  hit: PackageHit | undefined;
  searched: boolean;
  follows: boolean;
  /** After following: the index's id. Answers what to say, if anything. */
  onFollowed: (index: string) => Promise<string | undefined>;
  onReview: (hit: PackageHit) => void;
}) {
  const { link, state, installed, hit } = props;
  const router = useRouter();
  const [note, setNote] = useState<string>();
  const [pending, start] = useTransition();
  const follow = () =>
    start(async () => {
      setNote(undefined);
      const r = await followIndex(link.index!.key, link.index!.url);
      if (r.error !== undefined) return setNote(r.error);
      if (r.index.error) return setNote(`Followed, but the index couldn’t be read: ${r.index.error}`);
      setNote(await props.onFollowed(r.index.id));
    });

  let body: React.ReactNode;
  if (state?.state === "new") {
    body = (
      <>
        <p>
          To install <code className="font-mono text-ink">{link.pkg}</code>, first follow the index at{" "}
          <b className="font-medium text-ink">{hostOf(link.index!.url)}</b>. Only follow it if you trust this key.
        </p>
        <KeyBlock value={link.index!.key} />
        <p className="text-[13px] text-ink-3">{link.index!.url}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending} onClick={follow} className={`${buttonClass.primary} h-9 px-4 text-[14px]`}>
            {pending ? "Following…" : "Follow this index"}
          </button>
        </div>
      </>
    );
  } else if (state?.state === "clash") {
    body = (
      <>
        <p>
          You already follow the index at <b className="font-medium text-ink">{hostOf(link.index!.url)}</b> with a different key (
          <code className="font-mono">{shortKey(state.key)}</code>). To switch keys, remove it under Indexes first.
        </p>
        <KeyBlock value={link.index!.key} label="The new key" />
      </>
    );
  } else if (installed) {
    body = (
      <p>
        <code className="font-mono text-ink">{link.pkg}</code> is installed here{installed.version ? `, version ${installed.version}` : ""}.
      </p>
    );
  } else if (hit) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          <code className="font-mono text-ink">{link.pkg}</code> {hit.version} is available.
        </p>
        <button type="button" onClick={() => props.onReview(hit)} className={`${buttonClass.primary} h-9 px-4 text-[14px]`}>
          Review and install
        </button>
      </div>
    );
  } else {
    body = (
      <p>
        {!props.follows ? (
          <>
            Follow an index under Indexes to find <code className="font-mono text-ink">{link.pkg}</code>.
          </>
        ) : props.searched ? (
          <>
            No index you follow lists <code className="font-mono text-ink">{link.pkg}</code>.
          </>
        ) : (
          "Strut isn’t answering."
        )}
      </p>
    );
  }

  return (
    <section aria-label="From the store" className={`${card} relative flex flex-col gap-3 p-5 text-[14px] text-ink-2 md:p-6`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">From the store</span>
        <button type="button" onClick={() => router.replace("/packages")} aria-label="Dismiss" className="-m-1 grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-raised hover:text-ink">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
            <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
          </svg>
        </button>
      </div>
      {body}
      {note && (
        <p role="alert" className="text-[13.5px] text-warn">
          {note}
        </p>
      )}
    </section>
  );
}

function KeyBlock({ value, label = "Its key" }: { value: string; label?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12.5px] text-ink-3">{label}</span>
      <code className="rounded-lg bg-raised px-3 py-2 font-mono text-[13px] break-all text-ink select-all">{value}</code>
    </div>
  );
}

// ── installed ───────────────────────────────────────────────────────────

/** Where an installed package came from, in a few words: a repo edited here, what the box follows (a bundle's part), a repository, a publisher's catalog. */
function cameFrom(p: Installed, followed: readonly Followed[], repo: PackageRepo | undefined): string {
  if (repo) return `Edited here, from ${repoWhere(repo)} @ ${repo.branch}`;
  const at = followedBySource(followed, p.source?.ref);
  if (at) {
    const { sub, part } = at;
    return part ? `Part of ${followedFrom(sub)}` : `Kept up to date from ${followedFrom(sub)}`;
  }
  if (p.door === "distro") return "Installed automatically";
  if (p.source?.ref.startsWith("git+")) return `From ${p.source.ref}${p.commit ? ` at ${p.commit.slice(0, 7)}` : ""}`;
  return p.source?.url ? `From ${hostOf(p.source.url)}` : "Installed";
}

function InstalledList({ installed, secretsKnown, followed, editing }: { installed: Installed[]; secretsKnown: boolean; followed: Followed[]; editing: PackageRepo[] }) {
  const [removing, setRemoving] = useState<Installed | null>(null);
  const repoOf = (pkg: string) => editing.find((r) => r.package === pkg);
  const [notice, setNotice] = useState<{ pkg: string; kept: UninstallResult["kept"] } | null>(null);
  return (
    <section aria-labelledby="installed" className="flex flex-col gap-3">
      <SectionLabel id="installed">Installed</SectionLabel>
      {notice && (
        <p aria-live="polite" className="rounded-xl bg-ok-soft px-4 py-3 text-[13.5px] text-ink-2">
          <span className="text-ok">Uninstalled {notice.pkg}.</span>{" "}
          {notice.kept.length
            ? `Kept edits to ${notice.kept.map((k) => k.name).join(", ")}.`
            : ""}
        </p>
      )}
      {installed.length === 0 ? (
        <p className={empty}>No packages yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {installed.map((p) => (
            <li key={p.package} className={`${card} flex flex-col gap-4 p-5`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-mono text-[14.5px] font-medium break-all text-ink">
                    {p.package}
                    {p.version && <span className="ml-2 font-sans text-[13px] font-normal text-ink-3">{p.version}</span>}
                  </span>
                  <span className="text-[13px] break-words text-ink-3">{cameFrom(p, followed, repoOf(p.package))}</span>
                </div>
                {p.door !== "distro" && !repoOf(p.package) && (
                  <button type="button" onClick={() => setRemoving(p)} className={small}>
                    Uninstall
                  </button>
                )}
              </div>
              <Items pkg={p} />
              {p.needs.length > 0 ? (
                <div className="flex flex-col gap-3 rounded-[12px] bg-warn-soft px-4 py-3.5">
                  <p className="text-[13.5px] text-ink-2">
                    Needs {p.needs.length === 1 ? "a key" : "keys"} to run:
                  </p>
                  {p.needs.map((name) => (
                    <SecretField key={name} name={name} />
                  ))}
                </div>
              ) : boxSecrets(p).length > 0 ? (
                <p className="text-[13px] text-ink-3">
                  {secretsKnown || p.missing ? "Keys set: " : "Keys: "}
                  <span className="font-mono">{boxSecrets(p).join(", ")}</span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {removing && (
        <UninstallDialog
          pkg={removing}
          onClose={() => setRemoving(null)}
          onDone={(kept) => {
            setNotice({ pkg: removing.package, kept });
            setRemoving(null);
          }}
        />
      )}
    </section>
  );
}

function Items({ pkg }: { pkg: InstalledPackage }) {
  const groups = itemsByKind(pkg);
  if (!groups.length) return null;
  return (
    <dl className="grid gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-[auto_1fr]">
      {groups.map((g) => (
        <div key={g.kind} className="contents">
          <dt className="text-ink-3">{g.label}</dt>
          <dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-ink-2">
            {g.named ? (
              g.items.map((i) => (
                <span key={i.name} className="font-mono text-[13px]" title={i.name}>
                  {shortName(pkg.package, i.name)}
                  {i.modified && <span className="ml-1 font-sans text-[12px] text-warn">edited here</span>}
                </span>
              ))
            ) : (
              <Counted items={g.items} pkg={pkg.package} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Too many to name: how many, and which were edited here (an uninstall keeps those). */
function Counted({ items, pkg }: { items: InstalledPackage["items"]; pkg: string }) {
  const edited = items.filter((i) => i.modified);
  return (
    <span>
      <span className="tabular">{items.length.toLocaleString("en-US")}</span>
      {edited.length > 0 && (
        <span className="ml-2 text-[12px] text-warn" title={edited.map((i) => shortName(pkg, i.name)).join(", ")}>
          {edited.length} edited here
        </span>
      )}
    </span>
  );
}

/** One key a package reads: write-only, it goes to strut's store and is never shown again. */
function SecretField({ name, onSaved }: { name: string; onSaved?: () => void }) {
  const [value, setValue] = useState("");
  const [state, setState] = useState<{ ok?: boolean; error?: string }>({});
  const [pending, start] = useTransition();
  const id = `secret-${name}`;
  const save = () =>
    start(async () => {
      const r = await setSecret(name, value);
      if (r.error) return setState({ error: r.error });
      setValue("");
      setState({ ok: true });
      onSaved?.();
    });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-col gap-1.5"
    >
      <label htmlFor={id} className="font-mono text-[13px] text-ink">
        {name}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={state.ok}
          placeholder={state.ok ? "Saved" : "Paste the value"}
          onChange={(e) => {
            setValue(e.target.value);
            setState({});
          }}
          className={`${fieldClass} h-10 max-w-[420px] min-w-0 flex-1 font-mono text-[14px]`}
        />
        {state.ok ? (
          <Dot tone="ok" label="Saved" />
        ) : (
          <button type="submit" disabled={pending || !value.trim()} className={`${buttonClass.secondary} h-10 px-4 text-[14px]`}>
            {pending ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      {state.error && <p className="text-[13px] text-warn">{state.error}</p>}
    </form>
  );
}

// ── Software ────────────────────────────────────────────────────────────

/**
 * The Software card (`plans/software.md` §4): one button that follows one
 * bundle's repository, as this admin, through From a repository's path.
 * What the bundle brings, and how each part stands, is its row under
 * Followed: the card knows the bundle's ref and one sentence, nothing it
 * holds. Remove Software is that row's Stop following.
 */
function SoftwareCard({ software, onFollowed, onRemove }: { software?: Followed; onFollowed: (f: Followed, before?: string) => void; onRemove: (id: string) => void }) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const add = () =>
    start(async () => {
      setError(undefined);
      const out = await followRepository(SOFTWARE_REF);
      if (out.error !== undefined) return setError(out.error);
      onFollowed(out.followed, out.before);
    });
  return (
    <section aria-labelledby="software" className="flex flex-col gap-3">
      <SectionLabel id="software">Software</SectionLabel>
      <div className={`${card} flex flex-col gap-3 p-5`}>
        <p className="text-[14.5px] text-ink">{SOFTWARE_WORDS}</p>
        {software ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-[13.5px] text-ink-2">
              <Dot tone="ok" label="On" />
              <span className="text-ink-3"> · {whoseWords(software)}.</span> Details under{" "}
              <a href={`#${rowAnchor(software.id)}`} className="text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink-3">
                Followed
              </a>
              .
            </p>
            <button type="button" onClick={() => onRemove(software.id)} className={small}>
              Remove Software
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span />
            <button type="button" disabled={pending} onClick={add} className={`${buttonClass.secondary} h-10 px-4 text-[14px]`}>
              {pending ? "Adding…" : "Add Software"}
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-[13.5px] break-words text-warn">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

// ── from a repository ───────────────────────────────────────────────────

/** How a repository's package comes in: once, followed, or opened to edit here and commit back. */
type Way = "once" | "follow" | "edit";
const WAYS: ReadonlyArray<{ way: Way; label: string; words: string; button: string; going: string }> = [
  { way: "once", label: "Install once", words: "Installs it once, as it is now.", button: "Install", going: "Installing…" },
  { way: "follow", label: "Follow", words: "Installs each new commit on the branch.", button: "Follow", going: "Following…" },
  { way: "edit", label: "Edit here", words: "Change it here, then commit back to the branch.", button: "Edit here", going: "Opening…" },
];

/**
 * A package's repository, given by its address: followed (the default),
 * strut installs the branch's package and each new commit's after it, as
 * this admin's; once, it is one install; to edit here, strut opens the
 * branch, installs it, and takes changes to it for a commit back (under
 * Editing). What is wrong with the address is said before anything is
 * sent.
 */
function FromRepository({
  connect,
  onFollowed,
  onEdited,
}: {
  connect: ConnectOffer[];
  onFollowed: (f: Followed, before?: string) => void;
  onEdited: (r: PackageRepo) => void;
}) {
  const [ref, setRef] = useState("");
  const [way, setWay] = useState<Way>("follow");
  const [error, setError] = useState<{ text: string; offer?: ConnectOffer }>();
  const [followed, setFollowed] = useState<string>();
  const [edited, setEdited] = useState<{ pkg: string; missingSecrets: string[] }>();
  const [pending, start] = useTransition();
  const chosen = WAYS.find((w) => w.way === way)!;
  const { watch, follow, note } = useInstallWatch(null);
  const going = !!watch && (watch.status === "queued" || watch.status === "running") && !note?.final;

  const submit = () => {
    const r = parseRepositoryRef(ref);
    if ("error" in r) return setError({ text: r.error });
    start(async () => {
      setError(undefined);
      setFollowed(undefined);
      setEdited(undefined);
      if (way === "follow") {
        const out = await followRepository(ref);
        if (out.error !== undefined) return setError({ text: out.error });
        onFollowed(out.followed, out.before);
        setRef("");
        setFollowed(out.followed.ref);
        return;
      }
      if (way === "edit") {
        const out = await editRepository(ref);
        if (out.error !== undefined) return setError({ text: out.error, offer: repoConnectFor(out.code, out.error, connect, r.address) });
        onEdited(out.repo);
        setRef("");
        setEdited({ pkg: out.repo.package, missingSecrets: out.missingSecrets });
        return;
      }
      const out = await installFromRepository(ref);
      if (out.status === undefined) return setError({ text: out.error });
      follow(out);
    });
  };
  // The address goes once its package is in.
  const landed = watch?.status === "done";
  useEffect(() => {
    if (landed) setRef("");
  }, [landed]);

  const done = watch?.status === "done" ? watch.result : null;
  const failed = watch?.status === "failed" ? watch : null;
  const offer = failed ? connectFor(failed.code, failed.error, connect) : undefined;

  return (
    <section aria-labelledby="from-repository" className="flex flex-col gap-3">
      <SectionLabel id="from-repository">From a repository</SectionLabel>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className={`${card} flex flex-col gap-3 p-5`}
      >
        <label htmlFor="repository" className="text-[14px] text-ink-2">
          A git repo’s address. Add @branch or #folder if needed.
        </label>
        <input
          id="repository"
          placeholder="git+https://host/owner/repo@branch#folder"
          value={ref}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setRef(e.target.value);
            setError(undefined);
          }}
          className={`${fieldClass} font-mono text-[14px]`}
        />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="sr-only">How to add it</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {WAYS.map((w) => (
              <label key={w.way} className="flex items-center gap-2 text-[14px] text-ink">
                <input
                  type="radio"
                  name="repository-way"
                  value={w.way}
                  checked={way === w.way}
                  disabled={pending}
                  onChange={() => {
                    setWay(w.way);
                    setError(undefined);
                  }}
                  className="size-4 accent-accent"
                />
                {w.label}
              </label>
            ))}
          </div>
          <span className="text-[13px] text-ink-3">{chosen.words}</span>
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p aria-live="polite" className="min-w-0 text-[13px] break-words">
            {error ? (
              <span role="alert" className="text-warn">
                {error.text}
              </span>
            ) : pending && way === "edit" ? (
              <span className="text-ink-3">Installing it. This can take a minute.</span>
            ) : followed ? (
              <span className="text-ink-2">
                Now following <code className="font-mono break-all">{followed}</code>.
              </span>
            ) : edited ? (
              <span className="text-ink-2">
                Now editing <code className="font-mono break-all">{edited.pkg}</code>. It’s under Editing.
              </span>
            ) : null}
          </p>
          <button type="submit" disabled={pending || going || !ref.trim()} className={`${buttonClass.secondary} h-10 px-4 text-[14px]`}>
            {pending ? chosen.going : chosen.button}
          </button>
        </div>
        {error?.offer && <ConnectLine offer={error.offer} then="try again" />}
        {edited && edited.missingSecrets.length > 0 && (
          <div className="flex flex-col gap-3 rounded-[12px] bg-warn-soft px-4 py-3.5">
            <p className="text-[13.5px] text-ink-2">Needs these keys to run:</p>
            {edited.missingSecrets.map((name) => (
              <SecretField key={name} name={name} />
            ))}
          </div>
        )}
        {watch && (
          <div className="flex flex-col gap-3 border-t border-rule-soft pt-3">
            {going && <InstallBar watch={watch} label={`Installing ${watch.ref}`} />}
            {note && <p className={`text-[13px] ${note.final ? "text-warn" : "text-ink-3"}`}>{note.text}</p>}
            {done && (
              <p className="text-[14px] text-ink-2">
                {done.already ? "Already installed: " : "Installed "}
                <code className="font-mono text-ink">{done.package}</code>
                {done.version && !done.already ? `, version ${done.version}` : ""}.
              </p>
            )}
            {done && done.missingSecrets.length > 0 && (
              <div className="flex flex-col gap-3 rounded-[12px] bg-warn-soft px-4 py-3.5">
                <p className="text-[13.5px] text-ink-2">Needs these keys to run:</p>
                {done.missingSecrets.map((name) => (
                  <SecretField key={name} name={name} />
                ))}
              </div>
            )}
            {failed && (
              <p role="alert" className="text-[13.5px] break-words text-warn">
                {failed.error}
              </p>
            )}
            {offer && <ConnectLine offer={offer} then="install it again" />}
          </div>
        )}
      </form>
    </section>
  );
}

/** What to do when strut could not read a private repository with this admin's own account: connect it, through the box's seam. */
function ConnectLine({ offer, then }: { offer: ConnectOffer; then: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13.5px] text-ink-2">
      <a href={connectHref(offer)} className={`${buttonClass.secondary} h-9 px-4 text-[14px]`}>
        Connect {offer.name}
      </a>
      <span>
        Connect your {offer.name} account, then {then}.
      </span>
    </div>
  );
}

/** How often a read of something the box follows is looked at again. */
const READ_POLL_MS = 1000;

/** A Followed row's anchor, which the Software card links to. */
const rowAnchor = (id: string) => `followed-${id}`;

/**
 * What the box follows (strut's subscriptions), each with what strut last
 * read and installed, whose it is, and Check now and Stop following; a
 * bundle as one row, its parts beneath it. `started`: followed from this
 * page, and the read each started; `reading`: those strut was installing
 * a release of when the page loaded; `ask`: the row whose Stop following
 * the Software card opened.
 */
function FollowedList(props: {
  followed: Followed[] | null;
  reading: string[];
  started: Started[];
  connect: ConnectOffer[];
  ask: { id: string; n: number } | null;
  onGone: (id: string) => void;
}) {
  const { followed: list, started, connect, ask } = props;
  const [notice, setNotice] = useState<string>();
  const reads = new Map(started.map((s) => [s.f.id, s]));
  if (list === null) return <p className={empty}>Strut isn’t answering.</p>;
  if (list.length === 0 && !notice) return null;

  return (
    <section aria-labelledby="followed" className="flex flex-col gap-3">
      <SectionLabel id="followed">Followed</SectionLabel>
      {notice && (
        <p aria-live="polite" className="rounded-xl bg-ok-soft px-4 py-3 text-[13.5px] text-ink-2">
          {notice}
        </p>
      )}
      {list.length > 0 && (
        <ul className={`${card} divide-y divide-rule-soft`}>
          {list.map((f) => (
            <FollowedRow
              key={`${f.id}:${reads.get(f.id)?.n ?? 0}`}
              first={f}
              all={list}
              read={reads.get(f.id) ?? (props.reading.includes(f.id) ? { ...(f.checkedAt ? { before: f.checkedAt } : {}) } : undefined)}
              connect={connect}
              {...(ask?.id === f.id ? { ask: ask.n } : {})}
              onGone={(uninstalled) => {
                props.onGone(f.id);
                setNotice(
                  `Stopped following ${followedFrom(f)}.${uninstalled.length ? ` Uninstalled ${uninstalled.join(", ")}.` : ""}`,
                );
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Whose it is, in a word or two. */
const whoseWords = (f: Followed) => (!f.actor ? "Nobody’s" : f.mine ? "Yours" : `${f.whose}’s`);

function FollowedRow(props: {
  first: Followed;
  /** Everything the box follows: who holds a package this one leaves alone. */
  all: Followed[];
  read?: { before?: string };
  connect: ConnectOffer[];
  /** Asked, by the Software card, to stop following: open the question here. */
  ask?: number;
  onGone: (uninstalled: string[]) => void;
}) {
  const { first, connect } = props;
  // While a read goes on: strut's record as the page last looked, and its install.
  const [live, setLive] = useState<Followed | null>(null);
  const [read, setRead] = useState<{ before?: string } | null>(props.read ?? null);
  const [install, setInstall] = useState<InstallWatch>();
  const [note, setNote] = useState<string>();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  // A newer reading of the page wins over the last look, once no read is going on.
  const [seen, setSeen] = useState(first);
  if (seen !== first) {
    setSeen(first);
    if (!read) setLive(null);
  }
  // Each ask from the card opens the question, and brings the row into view.
  const [asked, setAsked] = useState(props.ask);
  if (asked !== props.ask) {
    setAsked(props.ask);
    if (props.ask) setAsking(true);
  }
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (props.ask) row.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [props.ask]);
  const f = live ?? first;

  useEffect(() => {
    if (!read) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const again = () => {
      if (!stopped) timer = setTimeout(look, READ_POLL_MS);
    };
    async function look() {
      if (stopped) return;
      if (document.visibilityState === "hidden") return again();
      const r = await followedProgress(first.id, read!.before).catch(() => ({ error: "Strut isn’t answering just now. Still trying.", retry: true }));
      if (stopped) return;
      if (r.error !== undefined) {
        setNote(r.error);
        return r.retry ? again() : setRead(null);
      }
      setNote(undefined);
      if (!r.followed) return setRead(null);
      setLive(r.followed);
      setInstall(r.install);
      if (r.followed.checkedAt && r.followed.checkedAt !== read!.before && !r.install) return setRead(null);
      again();
    }
    timer = setTimeout(look, 300);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [read, first.id]);

  const check = () =>
    start(async () => {
      setError(undefined);
      const r = await checkFollowed(f.id);
      if (r.error !== undefined) return setError(r.error);
      setRead({ ...(r.before ? { before: r.before } : {}) });
    });
  const stop = () =>
    start(async () => {
      setError(undefined);
      const r = await unfollow(f.id);
      if (r.error !== undefined) return setError(r.error);
      props.onGone(r.uninstalled);
    });
  // A key set here: the read it starts is followed in this row (a bundle's, once every part is read).
  const reread = () => setRead({ ...(f.checkedAt ? { before: f.checkedAt } : {}) });

  const state = followedState(f);
  const bundle = f.applied?.bundle;
  // A bundle installs a part at a time: the one going now, by the install's source.
  const installing = install && f.parts ? followedBySource([f], install.ref)?.part : undefined;

  return (
    <li ref={row} id={rowAnchor(f.id)} className="flex scroll-mt-6 flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <code className="font-mono text-[14px] break-all text-ink">{followedFrom(f)}</code>
          <span className="text-[13px] text-ink-3">
            {bundle && (
              <>
                Bundle <span className="font-mono text-[12.5px]">{bundle.package}</span>
                {bundle.version ? ` ${bundle.version}` : ""} ·{" "}
              </>
            )}
            {whoseWords(f)}
            {f.checkedAt ? ` · checked ${relativeTime(f.checkedAt)}` : ""}
          </span>
        </div>
        <span className="text-[13px]">{read ? <Dot tone="pending" label="Reading…" /> : <Dot tone={state.tone} label={state.label} />}</span>
      </div>

      {read &&
        (install ? (
          <InstallBar watch={install} label={`Installing ${followedFrom(installing ?? f)}`} />
        ) : (
          <p className="text-[13px] text-ink-3">Checking…</p>
        ))}
      {note && <p className="text-[13px] text-ink-3">{note}</p>}

      {f.parts ? (
        <>
          <Problems f={f} read={!!read} connect={connect} again="follow it again above" />
          {f.parts.length > 0 && (
            <ul aria-label="Its parts" className="flex flex-col gap-3 border-l-2 border-rule-soft pl-4">
              {f.parts.map((p) => (
                <li key={p.id} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <code className="min-w-0 font-mono text-[13px] break-all text-ink-2">{followedFrom(p)}</code>
                    <span className="text-[12.5px]">{installing?.id === p.id ? <Dot tone="pending" label="Installing…" /> : <Dot {...followedState(p)} />}</span>
                  </div>
                  <Release f={p} all={props.all} read={!!read} onSaved={reread} />
                  <Problems f={p} read={!!read} connect={connect} again="follow the bundle again above" />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <Release f={f} all={props.all} read={!!read} onSaved={reread} />
          <Problems f={f} read={!!read} connect={connect} again="follow it again above" />
        </>
      )}

      {asking && (
        <p className="text-[13.5px] text-ink-2">
          Stop following it? Everything it installed is removed for everyone. Run history and edits are kept.
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13.5px] break-words text-warn">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {asking ? (
          <>
            <button type="button" disabled={pending} onClick={() => setAsking(false)} className={buttonClass.quiet}>
              Cancel
            </button>
            <button type="button" disabled={pending} onClick={stop} className={small}>
              {pending ? "Stopping…" : "Stop following"}
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={pending || !!read} onClick={check} className={small}>
              {read ? "Checking…" : "Check now"}
            </button>
            <button type="button" disabled={pending || !!read} onClick={() => setAsking(true)} className={small}>
              Stop following
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * What a followed repository (or a bundle's part) is at: the commit and
 * the packages it installed, the keys a package waits for (each settable
 * here, and the read it starts followed), and a package another
 * subscription holds, left to it.
 */
function Release({ f, all, read, onSaved }: { f: Followed; all: Followed[]; read: boolean; onSaved: () => void }) {
  const at = f.applied?.commit?.slice(0, 7);
  return (
    <>
      {f.packages.length > 0 && (
        <p className="text-[13.5px] text-ink-2">
          {at ? `At ${at}: ` : ""}
          {f.packages.map((p, i) => (
            <span key={p.package}>
              {i > 0 && ", "}
              <code className="font-mono text-[13px] text-ink">{p.package}</code>
              {p.version && <span className="text-ink-3"> {p.version}</span>}
              {p.diverged.length > 0 && <span className="text-[12px] text-warn"> · {p.diverged.length} edited here</span>}
            </span>
          ))}
        </p>
      )}
      {f.packages.length === 0 && at && !f.waiting && !f.held && !f.error && !read && <p className="text-[13.5px] text-ink-3">At {at}. Nothing installed.</p>}

      {f.waiting && (
        <div className="flex flex-col gap-3 rounded-[12px] bg-warn-soft px-4 py-3.5">
          <p className="text-[13.5px] text-ink-2">
            Needs {f.waiting.secrets.length === 1 ? "a key" : "keys"} before it installs:
          </p>
          {f.waiting.secrets.map((name) => (
            <SecretField key={name} name={name} onSaved={onSaved} />
          ))}
        </div>
      )}

      {f.held?.map((h) => {
        // Who holds it: what the box follows that installed it, a bundle's part named with its bundle; none, once stopped.
        const at = followedBySource(all, h.by);
        return (
          <p key={h.package} className="text-[13.5px] text-ink-2">
            <code className="font-mono text-[13px] text-ink">{h.package}</code>{" "}
            {at
              ? `is kept up to date by ${at.part ? `${followedFrom(at.part)}, part of ${followedFrom(at.sub)}` : followedFrom(at.sub)} instead.`
              : "moves here at the next check."}
          </p>
        );
      })}
    </>
  );
}

/**
 * What stopped its last read, in plain words, and the account to connect
 * when strut couldn't read a private repository: this admin's own, or
 * whose it is. `again`: how this admin makes it theirs instead.
 */
function Problems({ f, read, connect, again }: { f: Followed; read: boolean; connect: ConnectOffer[]; again: string }) {
  const offer = f.error ? connectFor(refusalCode(f.error), f.error, connect, f.tokenSecret) : undefined;
  return (
    <>
      {f.error && !read && (
        <div className="flex flex-col gap-2">
          <p className="text-[13.5px] break-words text-warn">{explainRefusal(f.error, 500)}</p>
          {offer &&
            (f.mine ? (
              <ConnectLine offer={offer} then="check it now" />
            ) : (
              <p className="text-[13.5px] text-ink-2">
                {f.actor
                  ? `${f.whose} needs to connect their account, or ${again} to use yours.`
                  : `${again.charAt(0).toUpperCase()}${again.slice(1)} to use your account.`}
              </p>
            ))}
        </div>
      )}
      {f.warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-[13px] text-ink-3">
          {f.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </>
  );
}

// ── editing ─────────────────────────────────────────────────────────────

/** A commit, short. */
const short = (sha: string) => sha.slice(0, 7);

/** How a change here is marked, in the row and the commit's file list. */
const MARKS = {
  new: "bg-ok-soft text-ok",
  edited: "bg-warn-soft text-warn",
  deleted: "bg-raised text-ink-3",
} as const;
const FILE_MARKS = { added: "new", modified: "edited", deleted: "deleted" } as const;

function Mark({ mark }: { mark: keyof typeof MARKS }) {
  return <span className={`rounded-md px-1.5 py-px font-sans text-[12px] ${MARKS[mark]}`}>{mark}</span>;
}

/**
 * The packages opened here as git repos (strut `specs/API.md` §16,
 * "Working on a repository"): changed here by anyone, from any door (the
 * builder, Jamie, an app's own pages), and committed back by an admin.
 * Each row: the repo and branch, the commit installed, what changed here
 * since, and Commit…, Pull and Close. Shown only while one is open.
 */
function EditingList({ repos, connect, onClosed }: { repos: PackageRepo[]; connect: ConnectOffer[]; onClosed: (pkg: string) => void }) {
  const [notice, setNotice] = useState<string>();
  if (repos.length === 0 && !notice) return null;
  return (
    <section aria-labelledby="editing" className="flex flex-col gap-3">
      <SectionLabel id="editing">Editing</SectionLabel>
      {notice && (
        <p aria-live="polite" className="rounded-xl bg-ok-soft px-4 py-3 text-[13.5px] text-ink-2">
          {notice}
        </p>
      )}
      {repos.length > 0 && (
        <ul className={`${card} divide-y divide-rule-soft`}>
          {repos.map((r) => (
            <EditingRow
              key={r.package}
              repo={r}
              connect={connect}
              onClosed={() => {
                onClosed(r.package);
                setNotice(`Closed ${r.package}. It stays installed.`);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function EditingRow({ repo: r, connect, onClosed }: { repo: PackageRepo; connect: ConnectOffer[]; onClosed: () => void }) {
  const [committing, setCommitting] = useState(false);
  const [asking, setAsking] = useState(false);
  const [pulled, setPulled] = useState<{ text: string; missingSecrets: string[] }>();
  // A conflict the last pull stopped on, until the page's reading of strut has it.
  const [stopped, setStopped] = useState<string[]>();
  const [failed, setFailed] = useState<{ error: string; code?: string }>();
  const [pending, start] = useTransition();
  const edits = repoEdits(r);
  const conflict = r.conflict ?? stopped;
  const waiting = !!conflict || !!r.merge;
  const offer = failed ? repoConnectFor(failed.code, failed.error, connect, r.url) : undefined;

  const pull = () =>
    start(async () => {
      setFailed(undefined);
      setPulled(undefined);
      const p = await pullRepo(r.package);
      if (p.error !== undefined) return setFailed(p);
      setStopped(p.conflict);
      if (p.conflict) return;
      const saved = p.local ? ` Your changes here went in first as ${short(p.local)}. Commit to push them.` : "";
      setPulled({ text: p.commit === r.commit && !p.local ? "Already up to date." : `Pulled. Now at ${short(p.commit)}.${saved}`, missingSecrets: p.missingSecrets });
    });
  const close = () =>
    start(async () => {
      setFailed(undefined);
      const c = await closeRepo(r.package);
      if (c.error) return setFailed({ error: c.error });
      onClosed();
    });

  return (
    <li className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <code className="font-mono text-[14px] break-all text-ink">{r.package}</code>
          <span className="text-[13px] break-all text-ink-3">
            {repoWhere(r)} @ {r.branch} · at <span className="font-mono text-[12.5px]">{short(r.commit)}</span>
          </span>
        </div>
        <span className="text-[13px]">
          {conflict ? (
            <Dot tone="attention" label="Conflict" />
          ) : edits.length ? (
            <Dot tone="pending" label={`${edits.length} change${edits.length === 1 ? "" : "s"}`} />
          ) : (
            <Dot tone="ok" label="No changes" />
          )}
        </span>
      </div>

      {edits.length > 0 && (
        <ul aria-label="Changed here" className="flex flex-wrap gap-x-3 gap-y-1.5 text-[13px] text-ink-2">
          {edits.map((e) => (
            <li key={`${e.kind}:${e.name}`} className="inline-flex items-center gap-1.5" title={`${e.kind} ${e.name}`}>
              <span className="font-mono">{shortName(r.package, e.name)}</span>
              <Mark mark={e.mark} />
            </li>
          ))}
        </ul>
      )}

      {conflict ? (
        <div className="rounded-[12px] bg-warn-soft px-4 py-3 text-[13.5px] text-ink-2">
          Pull stopped on a conflict in <span className="font-mono text-[13px] break-all text-ink">{conflict.join(", ")}</span>. Resolve{" "}
          {conflict.length === 1 ? "it" : "them"} in <code className="font-mono text-[13px] break-all text-ink">{r.workdir}</code>, then pull again.
        </div>
      ) : r.merge ? (
        <p className="text-[13.5px] text-ink-2">A merge is ready. Pull again to finish it.</p>
      ) : null}

      {pulled && <p className="text-[13.5px] text-ink-2">{pulled.text}</p>}
      {pulled && pulled.missingSecrets.length > 0 && (
        <div className="flex flex-col gap-3 rounded-[12px] bg-warn-soft px-4 py-3.5">
          <p className="text-[13.5px] text-ink-2">Needs these keys to run:</p>
          {pulled.missingSecrets.map((name) => (
            <SecretField key={name} name={name} />
          ))}
        </div>
      )}
      {failed && (
        <p role="alert" className="text-[13.5px] break-words text-warn">
          {failed.error}
        </p>
      )}
      {offer && <ConnectLine offer={offer} then="try again" />}
      {asking && <p className="text-[13.5px] text-ink-2">Close it? It stays installed. A commit made here and not pushed is lost.</p>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {asking ? (
          <>
            <button type="button" disabled={pending} onClick={() => setAsking(false)} className={buttonClass.quiet}>
              Cancel
            </button>
            <button type="button" disabled={pending} onClick={close} className={small}>
              {pending ? "Closing…" : "Close"}
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={pending || waiting} onClick={() => setCommitting(true)} className={small} title={waiting ? "Finish the pull first" : undefined}>
              Commit…
            </button>
            <button type="button" disabled={pending} onClick={pull} className={small}>
              {pending ? "Pulling…" : "Pull"}
            </button>
            <button type="button" disabled={pending} onClick={() => setAsking(true)} className={small}>
              Close
            </button>
          </>
        )}
      </div>

      {committing && <CommitDialog repo={r} connect={connect} onClose={() => setCommitting(false)} />}
    </li>
  );
}

/**
 * Commit, asked first: the files it would push (strut writes the changes
 * made here into its copy and says what differs), a message, and where it
 * goes: straight to the branch (the default), or a new branch with a pull
 * request into it. Strut commits as this admin and pushes with their own
 * account. A refusal shows in plain words, with the account to connect
 * when strut couldn't push with theirs.
 */
function CommitDialog({ repo: r, connect, onClose }: { repo: PackageRepo; connect: ConnectOffer[]; onClose: () => void }) {
  const [changes, setChanges] = useState<PackageRepoDiff | null>(null);
  const [message, setMessage] = useState("");
  const [straight, setStraight] = useState(true);
  const [done, setDone] = useState<PackageRepoCommit>();
  const [failed, setFailed] = useState<{ error: string; code?: string }>();
  const [pending, start] = useTransition();
  useEffect(() => {
    let live = true;
    void repoChanges(r.package).then((c) => {
      if (!live) return;
      if (c.error !== undefined) setFailed(c);
      else setChanges(c.diff);
    });
    return () => {
      live = false;
    };
  }, [r.package]);
  const commit = () =>
    start(async () => {
      setFailed(undefined);
      const c = await commitRepo(r.package, message, straight);
      if (c.error !== undefined) return setFailed(c);
      setDone(c.commit);
    });
  const offer = failed ? repoConnectFor(failed.code, failed.error, connect, r.url) : undefined;

  if (done) {
    return (
      <Modal label={`Commit ${r.package}`} onClose={onClose}>
        <h2 className="text-[19px] font-medium">{done.committed ? `Pushed to ${done.branch ?? r.branch}` : "Nothing to commit"}</h2>
        <p className="text-[14px] text-ink-2">
          {done.committed ? (
            <>
              Commit <span className="font-mono text-[13px]">{short(done.commit)}</span>
              {done.branch && done.branch !== r.branch ? `, on a new branch.` : "."}
            </>
          ) : (
            `The repo has everything changed here.`
          )}
        </p>
        {done.pr && (
          <a href={done.pr.url} target="_blank" rel="noopener noreferrer" className="text-[14px] text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink-3">
            Pull request #{done.pr.number}
          </a>
        )}
        {done.prSkipped && <p className="text-[13.5px] text-ink-3">No pull request: {done.prSkipped}.</p>}
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={`${buttonClass.primary} h-9 px-4 text-[14px]`}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal label={`Commit ${r.package}`} onClose={pending ? () => {} : onClose}>
      <div className="flex flex-col gap-1">
        <h2 className="text-[19px] font-medium">
          Commit <span className="font-mono text-[17px] break-all">{r.package}</span>
        </h2>
        <p className="text-[13.5px] break-all text-ink-3">
          {repoWhere(r)} @ {r.branch}
        </p>
      </div>

      {changes === null ? (
        !failed && <p className="text-[13.5px] text-ink-3">Reading the changes…</p>
      ) : changes.files.length === 0 ? (
        <p className="text-[13.5px] text-ink-3">No file changes since {short(r.commit)}.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <ul aria-label="Files" className="flex max-h-[200px] flex-col gap-1 overflow-y-auto text-[13px]">
            {changes.files.map((f) => (
              <li key={f.path} className="flex items-center gap-2">
                <Mark mark={FILE_MARKS[f.status]} />
                <span className="min-w-0 font-mono break-all text-ink-2">{f.path}</span>
              </li>
            ))}
          </ul>
          {changes.patch && (
            <details className="text-[13px]">
              <summary className="text-ink-2">Show the diff{changes.truncated ? " (cut short)" : ""}</summary>
              <pre className="mt-2 max-h-[280px] overflow-auto rounded-lg bg-raised p-3 font-mono text-[12px] leading-[1.5] text-ink-2">{changes.patch}</pre>
            </details>
          )}
        </div>
      )}

      <label className="flex flex-col gap-1.5 text-[14px] text-ink-2">
        Message
        <textarea
          rows={3}
          value={message}
          placeholder="What changed"
          onChange={(e) => setMessage(e.target.value)}
          className={`${fieldClass} h-auto py-2.5 text-[14px]`}
        />
      </label>
      <label className="flex items-start gap-2.5 text-[14px] text-ink">
        <input type="checkbox" checked={straight} onChange={(e) => setStraight(e.target.checked)} className="mt-[3px] size-4 accent-accent" />
        <span className="flex flex-col gap-0.5">
          Push straight to {r.branch}
          <span className="text-[13px] text-ink-3">{straight ? `Goes onto ${r.branch} itself.` : `Goes on a new branch, with a pull request into ${r.branch}.`}</span>
        </span>
      </label>

      {failed && (
        <p role="alert" className="text-[13.5px] break-words text-warn">
          {failed.error}
        </p>
      )}
      {offer && <ConnectLine offer={offer} then="commit again" />}
      <div className="flex flex-wrap justify-end gap-1.5">
        <button type="button" disabled={pending} onClick={onClose} className={buttonClass.quiet}>
          Cancel
        </button>
        <button type="button" disabled={pending || !message.trim()} onClick={commit} className={`${buttonClass.primary} h-9 px-4 text-[14px]`}>
          {pending ? "Pushing…" : "Commit and push"}
        </button>
      </div>
    </Modal>
  );
}

// ── find ────────────────────────────────────────────────────────────────

function Find(props: {
  initialQuery: string;
  found: Found | null;
  onFound: (f: Found) => void;
  installed: Map<string, Installed>;
  indexLabel: (id: string) => string;
  follows: boolean;
  onInstall: (hit: PackageHit) => void;
}) {
  const { found, onFound } = props;
  const [q, setQ] = useState(props.initialQuery);
  const [error, setError] = useState<string>();
  const [searching, setSearching] = useState(false);
  const asked = useRef(props.initialQuery);
  const seq = useRef(0);

  // One search per pause in the typing; only the newest answer shows.
  useEffect(() => {
    if (q.trim() === asked.current.trim()) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      asked.current = q;
      setSearching(true);
      const r = await findPackages(q);
      if (seq.current !== mine) return;
      setSearching(false);
      if ("error" in r) return setError(r.error);
      setError(undefined);
      onFound(r);
    }, 300);
    return () => clearTimeout(t);
  }, [q, onFound]);

  return (
    <section aria-labelledby="find" className="flex flex-col gap-3">
      <SectionLabel id="find">Find</SectionLabel>
      <input
        type="search"
        aria-label="Search packages"
        placeholder={props.follows ? "Search the indexes you follow" : "Follow an index below to search it"}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className={fieldClass}
      />
      {error && <p className="text-[13.5px] text-warn">{error}</p>}
      {found?.errors.map((e) => (
        <p key={e.index} className="text-[13px] text-warn">
          {props.indexLabel(e.index)} couldn’t be read: {e.error}
        </p>
      ))}
      {!props.follows ? null : found === null ? (
        <p className={empty}>Strut isn’t answering.</p>
      ) : found.hits.length === 0 ? (
        <p className={empty}>{searching ? "Searching…" : q.trim() ? "Nothing matches." : "Nothing listed yet."}</p>
      ) : (
        <ul className={`flex flex-col gap-3 ${searching ? "opacity-60" : ""}`}>
          {found.hits.map((h) => {
            const here = props.installed.get(h.package);
            return (
              <li key={`${h.index}:${h.package}`} className={`${card} flex flex-col gap-3 p-5`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-mono text-[14.5px] font-medium break-all text-ink">
                      {h.package}
                      <span className="ml-2 font-sans text-[13px] font-normal text-ink-3">{h.version}</span>
                    </span>
                    {h.description && <span className="text-[14px] text-ink-2">{h.description}</span>}
                  </div>
                  {here?.digest === h.digest ? (
                    <Dot tone="ok" label="Installed" />
                  ) : (
                    <button type="button" onClick={() => props.onInstall(h)} className={small}>
                      {here ? "Review" : "Install"}
                    </button>
                  )}
                </div>
                <Facts hit={h} />
                <p className="text-[12.5px] text-ink-3">
                  Listed by {props.indexLabel(h.index)}
                  {h.license ? ` · ${h.license}` : ""}
                  {here && here.digest !== h.digest ? ` · version ${here.version ?? "another"} is installed` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** What a hit brings, what it can do and the keys it reads: the index's reading of the release. */
function Facts({ hit }: { hit: PackageHit }) {
  const secrets = hitSecrets(hit);
  const d = hit.detail;
  return (
    <dl className="grid gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-[auto_1fr]">
      <dt className="text-ink-3">Brings</dt>
      <dd className="text-ink-2">
        {!d ? (
          "Not known yet."
        ) : (
          <>
            {bringsWords(d).join(", ") || "Nothing listed"}
            {d.apps.length > 0 && <span className="text-ink-3"> · {d.apps.map((a) => a.title).join(", ")}</span>}
          </>
        )}
      </dd>
      {d && (
        <>
          <dt className="text-ink-3">Can</dt>
          <dd className="flex flex-wrap gap-1.5">
            {canWords(d.can).map((w) => (
              <span key={w} className={`rounded-md px-2 py-0.5 text-[12.5px] ${w === "Only reads" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"}`}>
                {w}
              </span>
            ))}
          </dd>
        </>
      )}
      <dt className="text-ink-3">Needs</dt>
      <dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-ink-2">
        {secrets.length ? (
          secrets.map((s) => (
            <span key={s} className="font-mono text-[13px] break-all">
              {s}
            </span>
          ))
        ) : (
          <span className="text-ink-3">No keys</span>
        )}
      </dd>
    </dl>
  );
}

// ── the confirmations ───────────────────────────────────────────────────

/** A modal the browser keeps: focus stays inside, Escape closes it. */
function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-[16px] border border-rule bg-surface p-0 text-ink shadow-soft backdrop:bg-black/40"
    >
      <div className="flex max-h-[calc(100dvh-64px)] flex-col gap-4 overflow-y-auto p-6">{children}</div>
    </dialog>
  );
}

/**
 * Install, asked first: what it brings, what it can do, the keys it reads,
 * where it comes from. Then how far it is, phase by phase, read from strut
 * as it goes; closing the dialog leaves the install going, shown under
 * Installing. Once installed, the keys it still needs can be set here. A
 * refusal shows in plain words and changes nothing.
 */
function InstallDialog(props: {
  hit: PackageHit;
  indexLabel: string;
  installed: Installed | undefined;
  onStarted: (id: string) => void;
  /** With the install when it is still going. */
  onClose: (going?: InstallWatch) => void;
}) {
  const { hit, indexLabel, installed } = props;
  const [refused, setRefused] = useState<string>();
  const [starting, start] = useTransition();
  const { watch, follow, note } = useInstallWatch(null);
  const other = installed && installed.digest !== hit.digest ? installed : undefined;
  const going = !!watch && (watch.status === "queued" || watch.status === "running") && !note?.final;
  const run = () =>
    start(async () => {
      setRefused(undefined);
      const r = await install(hit.package, hit.index, hit.digest || undefined);
      if (r.status === undefined) return setRefused(r.error);
      if (r.id) props.onStarted(r.id);
      follow(r);
    });
  const close = () => props.onClose(going ? watch! : undefined);
  const done = watch?.status === "done" ? watch.result : null;
  const error = refused ?? (watch?.status === "failed" ? watch.error : note?.final ? note.text : undefined);

  return (
    <Modal label={`Install ${hit.package}`} onClose={starting ? () => {} : close}>
      {done ? (
        <>
          <h2 className="text-[19px] font-medium">{done.already ? `${done.package} was already installed` : `Installed ${done.package}`}</h2>
          <p className="text-[14px] text-ink-2">
            {done.already ? "Nothing changed." : `Version ${done.version ?? hit.version}. Everyone can use its apps now.`}
          </p>
          {done.missingSecrets.length > 0 && (
            <div className="flex flex-col gap-3 rounded-[12px] bg-warn-soft px-4 py-3.5">
              <p className="text-[13.5px] text-ink-2">Needs these keys to run:</p>
              {done.missingSecrets.map((name) => (
                <SecretField key={name} name={name} />
              ))}
            </div>
          )}
          {done.warnings.length > 0 && (
            <ul className="flex flex-col gap-1 text-[13px] text-ink-3">
              {done.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <button type="button" onClick={close} className={`${buttonClass.primary} h-9 px-4 text-[14px]`}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <h2 className="text-[19px] font-medium">
              Install <span className="font-mono text-[17px] break-all">{hit.package}</span>?
            </h2>
            <p className="text-[13.5px] text-ink-3">
              Version {hit.version}
              {hit.license ? ` · ${hit.license}` : ""} · published by {hit.publisher}, listed by {indexLabel}
            </p>
          </div>
          {hit.description && <p className="text-[14px] text-ink-2">{hit.description}</p>}
          <Facts hit={hit} />
          <p className="text-[13.5px] text-ink-2">
            Its code runs with the keys you give it. Only install it if you trust {hit.publisher}.
          </p>
          {other && (
            <p className="rounded-[12px] bg-warn-soft px-4 py-3 text-[13.5px] text-ink-2">
              Version {other.version ?? "another"} is installed. Uninstall it first.
            </p>
          )}
          {going && (
            <div className="flex flex-col gap-2 rounded-[12px] bg-raised/60 px-4 py-3.5">
              <InstallBar watch={watch!} label={`Installing ${hit.package}`} />
              <p className="text-[13px] text-ink-3">{note ? note.text : "You can close this. The install keeps going."}</p>
            </div>
          )}
          {error && (
            <p role="alert" className="text-[13.5px] break-words text-warn">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-1.5">
            <button type="button" disabled={starting} onClick={close} className={buttonClass.quiet}>
              {going ? "Close" : "Cancel"}
            </button>
            <button type="button" disabled={starting || going || !!other} onClick={run} className={`${buttonClass.primary} h-9 px-4 text-[14px]`}>
              {starting || going ? "Installing…" : error ? "Try again" : "Install"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function UninstallDialog({ pkg, onClose, onDone }: { pkg: Installed; onClose: () => void; onDone: (kept: UninstallResult["kept"]) => void }) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await uninstall(pkg.package);
      if (r.error !== undefined) return setError(r.error);
      onDone(r.kept);
    });
  return (
    <Modal label={`Uninstall ${pkg.package}`} onClose={pending ? () => {} : onClose}>
      <h2 className="text-[19px] font-medium">
        Uninstall <span className="font-mono text-[17px] break-all">{pkg.package}</span>?
      </h2>
      <p className="text-[14px] text-ink-2">
        It’s removed for everyone. Run history, edits and keys are kept.
      </p>
      {error && (
        <p role="alert" className="text-[13.5px] text-warn">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-1.5">
        <button type="button" disabled={pending} onClick={onClose} className={buttonClass.quiet}>
          Cancel
        </button>
        <button type="button" disabled={pending} onClick={run} className={`${buttonClass.primary} h-9 px-4 text-[14px]`}>
          {pending ? "Uninstalling…" : "Uninstall"}
        </button>
      </div>
    </Modal>
  );
}

// ── indexes ─────────────────────────────────────────────────────────────

/** The indexes the box follows: a package's name resolves through the first whose card lists its publisher. */
function Indexes({ indexes }: { indexes: PackageIndex[] }) {
  const [key, setKey] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const add = () =>
    start(async () => {
      const r = await followIndex(key, url);
      if (r.error !== undefined) return setError(r.error);
      setError(r.index.error ? `Followed, but the index couldn’t be read: ${r.index.error}` : undefined);
      setKey("");
      setUrl("");
    });

  return (
    <section aria-labelledby="indexes" className="flex flex-col gap-3">
      <SectionLabel id="indexes">Indexes</SectionLabel>
      <p className="text-[14px] text-ink-2">Packages are found through the indexes you follow.</p>
      {indexes.length === 0 ? (
        <p className={empty}>None yet.</p>
      ) : (
        <ul className={`${card} divide-y divide-rule-soft`}>
          {indexes.map((i) => (
            <IndexRow key={i.id} index={i} />
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className={`${card} flex flex-col gap-3 p-5`}
      >
        <span className="text-[14px] font-medium text-ink">Follow an index</span>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            aria-label="Index address"
            placeholder="https://index.example/index/catalog"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(undefined);
            }}
            className={fieldClass}
          />
          <input
            aria-label="Key"
            placeholder="Key"
            value={key}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setKey(e.target.value);
              setError(undefined);
            }}
            className={`${fieldClass} font-mono text-[14px]`}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p aria-live="polite" className="text-[13px] text-ink-3">
            {error ? <span className="text-warn">{error}</span> : "Copy both from the index’s own site."}
          </p>
          <button type="submit" disabled={pending || !key.trim() || !url.trim()} className={`${buttonClass.secondary} h-10 px-4 text-[14px]`}>
            {pending ? "Following…" : "Follow"}
          </button>
        </div>
      </form>
    </section>
  );
}

function IndexRow({ index: i }: { index: PackageIndex }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const remove = () =>
    start(async () => {
      const r = await unfollowIndex(i.id);
      if (r.error) setError(r.error);
    });
  return (
    <li className="flex flex-col gap-2 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[14.5px] font-medium text-ink">{i.label ?? i.id}</span>
          <span className="text-[13px] break-all text-ink-3">{i.urls.join(", ")}</span>
          <code className="font-mono text-[12.5px] text-ink-3" title={i.key}>
            {shortKey(i.key)}
          </code>
        </div>
        <div className="flex items-center gap-3 text-[13px]">
          {i.error ? <Dot tone="attention" label="Can’t be read" /> : i.read ? <Dot tone="ok" label={`${i.read.publishers} publisher${i.read.publishers === 1 ? "" : "s"}`} /> : null}
          {asking ? (
            <>
              <button type="button" onClick={() => setAsking(false)} className={buttonClass.quiet}>
                Cancel
              </button>
              <button type="button" disabled={pending} onClick={remove} className={small}>
                {pending ? "Removing…" : "Stop following"}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setAsking(true)} className={small}>
              Remove
            </button>
          )}
        </div>
      </div>
      {i.error && <p className="text-[13px] break-words text-warn">{i.error}</p>}
      {asking && <p className="text-[13px] text-ink-3">What was installed through it stays installed.</p>}
      {error && <p className="text-[13px] text-warn">{error}</p>}
    </li>
  );
}
