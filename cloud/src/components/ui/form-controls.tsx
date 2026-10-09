import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const field =
  "w-full min-w-0 rounded-lg border border-input bg-white/[0.03] px-3 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground/70 hover:border-white/20 focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive [&_option]:bg-popover";

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(field, "h-9 py-1", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(field, "min-h-20 py-2 leading-relaxed", className)} {...props} />;
}

/** Native select styled like shadcn's: accessible and keyboard-friendly without extra deps. */
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select data-slot="select" className={cn(field, "h-9 appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-8", "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]", className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label data-slot="label" className={cn("flex items-center gap-2 text-sm font-medium leading-none select-none", className)} {...props} />;
}

export function FieldHint({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

/** A checkbox rendered as a switch. */
export function Switch({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      role="switch"
      data-slot="switch"
      className={cn(
        "relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-input transition-colors outline-none",
        "before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-background before:shadow before:transition-transform",
        "checked:bg-primary checked:before:translate-x-4 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
