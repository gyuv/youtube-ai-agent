import Link from "next/link";
import { YOUTUBE_TERMS_URL } from "@/lib/publicInfo";
import { cn } from "@/lib/utils";

/** Privacy, Terms and the YouTube API disclosure, linked from every page. */
export function PolicyFooter({ className }: { className?: string }) {
  return (
    <footer className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      <span>
        Uses{" "}
        <a href={YOUTUBE_TERMS_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">
          YouTube API Services
        </a>
      </span>
      <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
        Privacy Policy
      </Link>
      <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
        Terms of Use
      </Link>
    </footer>
  );
}
