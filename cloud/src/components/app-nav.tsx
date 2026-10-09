"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Dashboard", match: (p: string) => p === "/" || p.startsWith("/projects") },
  { href: "/channels", label: "Channels", match: (p: string) => p.startsWith("/channels") },
  { href: "/script-lab", label: "Script Lab", match: (p: string) => p.startsWith("/script-lab") },
  { href: "/edit-lab", label: "Edit Lab", match: (p: string) => p.startsWith("/edit-lab") },
  { href: "/growth-lab", label: "Growth Lab", match: (p: string) => p.startsWith("/growth-lab") },
  { href: "/research", label: "Research", match: (p: string) => p.startsWith("/research") },
  { href: "/clips", label: "Clips", match: (p: string) => p.startsWith("/clips") },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="scrollbar-none flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-full border bg-white/[0.03] p-1" aria-label="Main">
      {LINKS.map((link) => {
        const active = link.match(pathname);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative shrink-0 rounded-full px-3 py-1 text-sm whitespace-nowrap transition-all duration-200",
              active
                ? "bg-white/[0.08] font-medium text-foreground shadow-[inset_0_1px_0_oklch(1_0_0/10%),0_0_0_1px_oklch(0.7_0.21_292/35%),0_4px_16px_-4px_oklch(0.62_0.24_310/50%)]"
                : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
