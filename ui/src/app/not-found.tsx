import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-16 sm:px-0">
      <h1 className="font-serif text-[40px] leading-tight tracking-[-0.02em]">Nothing here</h1>
      <Link href="/" className="mt-8 text-[15px] text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
        Back to your apps
      </Link>
    </main>
  );
}
