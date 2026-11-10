"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { buttonClass } from "@/components/button";
import { fieldClass } from "@/components/form";
import { SectionLabel } from "@/components/page-header";
import { Dot } from "@/components/state";
import {
  bringsWords,
  canWords,
  hitSecrets,
  hostOf,
  itemsByKind,
  linkIndexState,
  shortKey,
  shortName,
  type InstallLink,
} from "@/lib/packages";
import type { InstalledPackage, PackageHit, PackageIndex, UninstallResult } from "@/lib/strut/client";
import { findPackages, followIndex, install, setSecret, uninstall, unfollowIndex, type InstallOutcome } from "./actions";

type Installed = InstalledPackage & { needs: string[] };
type Found = { hits: PackageHit[]; errors: Array<{ index: string; error: string }> };

const card = "rounded-xl border border-rule bg-surface";
const small =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-rule-strong bg-surface px-3 text-[13px] font-medium text-ink transition-colors duration-150 hover:border-ink-3 disabled:pointer-events-none disabled:opacity-50";
const empty = "rounded-xl border border-dashed border-dash px-5 py-6 text-[14px] text-ink-2";

/**
 * The page: the store's link when it brought the admin here, what is
 * installed, a search over the indexes, and the indexes. Install and
 * Uninstall each ask first; the link only ever opens the question.
 */
export function PackagesView(props: { link: InstallLink | null; installed: Installed[]; secretsKnown: boolean; indexes: PackageIndex[]; initial: Found | null }) {
  const { link, installed, indexes } = props;
  const byName = useMemo(() => new Map(installed.map((p) => [p.package, p])), [installed]);
  const indexLabel = (id: string) => indexes.find((i) => i.id === id)?.label ?? id;

  // The link's package, as the indexes list it: from the link's index when it names one.
  const linkState = link?.index ? linkIndexState(link.index, indexes) : null;
  const linkHit = (found: Found | null) =>
    link ? found?.hits.find((h) => h.package === link.pkg && (linkState?.state !== "followed" || h.index === linkState.id)) : undefined;
  const opensAtOnce = !!link && (!link.index || linkState?.state === "followed") && !byName.has(link.pkg);
  const [reviewing, setReviewing] = useState<PackageHit | null>(() => (opensAtOnce ? (linkHit(props.initial) ?? null) : null));
  const [found, setFound] = useState<Found | null>(props.initial);

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

      <InstalledList installed={installed} secretsKnown={props.secretsKnown} />

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
          onClose={() => setReviewing(null)}
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
      if (r.index.error) return setNote(`Followed, but its card couldn’t be read: ${r.index.error}`);
      setNote(await props.onFollowed(r.index.id));
    });

  let body: React.ReactNode;
  if (state?.state === "new") {
    body = (
      <>
        <p>
          The store at <b className="font-medium text-ink">{hostOf(link.index!.url)}</b> sent you here to install{" "}
          <code className="font-mono text-ink">{link.pkg}</code>. This box doesn’t follow that index yet. Following it trusts this key to say which
          publisher is which; every install is still checked against the publisher’s own signed catalog.
        </p>
        <KeyBlock value={link.index!.key} />
        <p className="text-[13px] text-ink-3">Its card: {link.index!.url}</p>
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
          The store at <b className="font-medium text-ink">{hostOf(link.index!.url)}</b> sent you here to install{" "}
          <code className="font-mono text-ink">{link.pkg}</code>, but this box already follows an index there under another key (
          <code className="font-mono">{shortKey(state.key)}</code>). A link never changes which key the box trusts: remove that index below first if
          you mean to replace it.
        </p>
        <KeyBlock value={link.index!.key} label="The link’s key" />
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
          <code className="font-mono text-ink">{link.pkg}</code> {hit.version} is listed. Nothing installs until you say so.
        </p>
        <button type="button" onClick={() => props.onReview(hit)} className={`${buttonClass.primary} h-9 px-4 text-[14px]`}>
          Review and install
        </button>
      </div>
    );
  } else {
    body = (
      <p>
        {!props.follows
          ? "This box follows no index yet, so it can’t find "
          : props.searched
            ? "No index this box follows lists "
            : "Strut isn’t answering, so it can’t look up "}
        <code className="font-mono text-ink">{link.pkg}</code>
        {!props.follows ? ". Add the index it’s listed on under Indexes." : "."}
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

function InstalledList({ installed, secretsKnown }: { installed: Installed[]; secretsKnown: boolean }) {
  const [removing, setRemoving] = useState<Installed | null>(null);
  const [notice, setNotice] = useState<{ pkg: string; kept: UninstallResult["kept"] } | null>(null);
  return (
    <section aria-labelledby="installed" className="flex flex-col gap-3">
      <SectionLabel id="installed">Installed</SectionLabel>
      {notice && (
        <p aria-live="polite" className="rounded-xl bg-ok-soft px-4 py-3 text-[13.5px] text-ink-2">
          <span className="text-ok">Uninstalled {notice.pkg}.</span>{" "}
          {notice.kept.length
            ? `Kept what was edited here: ${notice.kept.map((k) => k.name).join(", ")}.`
            : "Its runs stay in the history."}
        </p>
      )}
      {installed.length === 0 ? (
        <p className={empty}>No packages yet. Find one below, or follow the store’s Install link.</p>
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
                  <span className="text-[13px] text-ink-3">
                    {p.door === "distro" ? "Installed by the box’s distro, which updates and removes it" : p.source?.url ? `From ${hostOf(p.source.url)}` : "Installed"}
                  </span>
                </div>
                {p.door !== "distro" && (
                  <button type="button" onClick={() => setRemoving(p)} className={small}>
                    Uninstall
                  </button>
                )}
              </div>
              <Items pkg={p} />
              {p.needs.length > 0 ? (
                <div className="flex flex-col gap-3 rounded-[12px] bg-warn-soft px-4 py-3.5">
                  <p className="text-[13.5px] text-ink-2">
                    Its steps read {p.needs.length === 1 ? "a key this box doesn’t have" : "keys this box doesn’t have"} yet. Each goes to strut and is never
                    shown again.
                  </p>
                  {p.needs.map((name) => (
                    <SecretField key={name} name={name} />
                  ))}
                </div>
              ) : p.secrets.length > 0 ? (
                <p className="text-[13px] text-ink-3">
                  {secretsKnown ? "Its keys are set: " : "Strut couldn’t say which of its keys are set: "}
                  <span className="font-mono">{p.secrets.join(", ")}</span>
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
function SecretField({ name }: { name: string }) {
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
        placeholder={props.follows ? "Search the indexes this box follows" : "Follow an index below to search it"}
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
        <p className={empty}>Strut isn’t answering, so the indexes can’t be searched right now.</p>
      ) : found.hits.length === 0 ? (
        <p className={empty}>{searching ? "Searching…" : q.trim() ? "Nothing matches." : "The indexes list nothing yet."}</p>
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
          "Not read yet: the index hasn’t opened this release."
        ) : (
          <>
            {bringsWords(d).join(", ") || "Nothing it can say"}
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
 * where it comes from. Once installed, the keys it still needs can be set
 * here. A refusal shows in plain words and changes nothing.
 */
function InstallDialog({ hit, indexLabel, installed, onClose }: { hit: PackageHit; indexLabel: string; installed: Installed | undefined; onClose: () => void }) {
  const [result, setResult] = useState<InstallOutcome | null>(null);
  const [pending, start] = useTransition();
  const other = installed && installed.digest !== hit.digest ? installed : undefined;
  const run = () => start(async () => setResult(await install(hit.package, hit.index, hit.digest || undefined)));
  const done = result && result.error === undefined ? result : null;

  return (
    <Modal label={`Install ${hit.package}`} onClose={pending ? () => {} : onClose}>
      {done ? (
        <>
          <h2 className="text-[19px] font-medium">{done.already ? `${done.package} was already installed` : `Installed ${done.package}`}</h2>
          <p className="text-[14px] text-ink-2">
            {done.already ? "Nothing changed." : `Version ${done.version ?? hit.version}. Its apps are in everyone’s list now.`}
          </p>
          {done.missingSecrets.length > 0 && (
            <div className="flex flex-col gap-3 rounded-[12px] bg-warn-soft px-4 py-3.5">
              <p className="text-[13.5px] text-ink-2">Its steps need these keys before they can run. Each goes to strut and is never shown again.</p>
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
            <button type="button" onClick={onClose} className={`${buttonClass.primary} h-9 px-4 text-[14px]`}>
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
            Its code runs on this box, with the keys you give it. Strut checks it against {hit.publisher}’s own signed catalog before it writes
            anything.
          </p>
          {other && (
            <p className="rounded-[12px] bg-warn-soft px-4 py-3 text-[13.5px] text-ink-2">
              Version {other.version ?? "another"} is installed here. Uninstall it first to install this one.
            </p>
          )}
          {pending && <p className="text-[13.5px] text-ink-3">Installing. Strut builds its apps first, which can take a minute.</p>}
          {result?.error && (
            <p role="alert" className="text-[13.5px] text-warn">
              {result.error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-1.5">
            <button type="button" disabled={pending} onClick={onClose} className={buttonClass.quiet}>
              Cancel
            </button>
            <button type="button" disabled={pending || !!other} onClick={run} className={`${buttonClass.primary} h-9 px-4 text-[14px]`}>
              {pending ? "Installing…" : "Install"}
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
        Its apps, workflows, steps and Concepts leave this box, for everyone. Their runs stay in the history, and anything people edited here is kept.
        Its keys stay in strut.
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
      setError(r.index.error ? `Followed, but its card couldn’t be read: ${r.index.error}` : undefined);
      setKey("");
      setUrl("");
    });

  return (
    <section aria-labelledby="indexes" className="flex flex-col gap-3">
      <SectionLabel id="indexes">Indexes</SectionLabel>
      <p className="text-[14px] text-ink-2">An index says which publisher is which. A package’s name is looked up in the first one that lists its publisher.</p>
      {indexes.length === 0 ? (
        <p className={empty}>This box follows no index yet.</p>
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
            aria-label="Where its card is served"
            placeholder="https://index.example/index/catalog"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(undefined);
            }}
            className={fieldClass}
          />
          <input
            aria-label="Its key"
            placeholder="Its key, 52 characters"
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
            {error ? <span className="text-warn">{error}</span> : "Take both from the index itself, never from a message."}
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
