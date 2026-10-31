import type { ReactNode } from "react";
import { cx } from "./cx";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-b-2 border-line-strong bg-surface-2 px-1.5 figures text-2xs text-ink-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
