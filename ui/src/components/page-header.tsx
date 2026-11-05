export function PageHeader({
  title,
  lede,
  children,
}: {
  title: React.ReactNode;
  lede?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-[34px] leading-[1.1] font-normal tracking-[-0.02em] text-ink md:text-[44px]">{title}</h1>
        {lede && <p className="text-[15px] text-ink-2">{lede}</p>}
      </div>
      {children}
    </header>
  );
}

/** Small uppercase section label, as on the board. */
export function SectionLabel({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase md:text-[13px]">
      {children}
    </h2>
  );
}
