import Link from "next/link";

const base =
  "inline-flex items-center justify-center gap-2 rounded-[10px] px-[18px] h-11 text-[15px] font-medium transition-[background-color,color,border-color,transform] duration-150 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";

export const buttonClass = {
  primary: `${base} bg-accent text-accent-ink hover:bg-accent-hover`,
  ink: `${base} bg-ink text-paper hover:opacity-90`,
  secondary: `${base} border border-rule-strong bg-surface text-ink hover:border-ink-3`,
  neutral: `${base} bg-neutral-soft text-ink hover:bg-raised`,
  quiet: `${base} h-9 px-3 text-ink-2 hover:text-ink hover:bg-raised`,
  danger: `${base} h-9 px-3 text-danger hover:bg-raised`,
};

export function ButtonLink({
  href,
  variant = "secondary",
  children,
}: {
  href: string;
  variant?: keyof typeof buttonClass;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass[variant]}>
      {children}
    </Link>
  );
}
