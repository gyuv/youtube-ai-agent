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
    <nav className="flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Main">
      {LINKS.map((link) => {
        const active = link.match(pathname);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
              active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
