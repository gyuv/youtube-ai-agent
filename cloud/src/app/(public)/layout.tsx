import { Clapperboard } from "lucide-react";
import Link from "next/link";
import { PolicyFooter } from "@/components/policy-footer";

/** Public pages: readable without the studio password. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-10 sm:px-6">
      <Link href="/login" className="mb-10 flex items-center gap-2 font-semibold">
        <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
          <Clapperboard className="size-4" />
        </span>
        Lumen Cloud
      </Link>
      <article className="grid gap-4 text-sm leading-relaxed text-muted-foreground [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_strong]:text-foreground [&_ul]:grid [&_ul]:list-disc [&_ul]:gap-1.5 [&_ul]:pl-5">
        {children}
      </article>
      <PolicyFooter className="mt-12 border-t pt-6" />
    </div>
  );
}
