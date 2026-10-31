"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ButtonIcon, buttonClasses, cx } from "@/components/ui";
import { NAV_LINKS, RECORDED_RUN_HREF, isStorePage } from "./links";
import { Wordmark } from "./Wordmark";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/demo") return pathname === "/demo";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export interface SiteNavProps {
  /** "compact" drops the CTA, for pages that carry their own primary action (the demo dashboard). */
  variant?: "default" | "compact";
}

/** Floating glass nav. Rendered once in the root layout; /demo routes get the compact variant automatically. */
export function SiteNav({ variant }: SiteNavProps) {
  const pathname = usePathname() ?? "/";
  const compact = variant ? variant === "compact" : pathname.startsWith("/demo");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Store pages must look like real shops; their reveal pill links back.
  if (isStorePage(pathname)) return null;

  const cta = (
    <Link href={RECORDED_RUN_HREF} className={buttonClasses({ size: "sm", withIcon: true })} onClick={() => setOpen(false)}>
      Watch a recorded run
      <ButtonIcon size="sm">
        <Play strokeWidth={1.75} />
      </ButtonIcon>
    </Link>
  );

  return (
    <header className="sticky top-0 z-30 px-3 pt-3 md:px-6">
      <nav
        aria-label="Main"
        className="glass bg-[color-mix(in_oklab,var(--canvas)_96%,transparent)]! mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 rounded-pill pl-4 pr-2 shadow-float"
      >
        <Link href="/" aria-label="CartHold home" className="rounded-pill" onClick={() => setOpen(false)}>
          <Wordmark />
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "rounded-pill px-3 py-1.5 text-sm transition-colors duration-[var(--duration-fast)] ease-snap",
                    active ? "bg-surface-3 text-ink" : "text-ink-muted hover:text-ink",
                  )}
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-2">
          {!compact && <div className="hidden sm:block">{cta}</div>}
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="site-menu"
            onClick={() => setOpen((o) => !o)}
            className="relative inline-flex size-10 items-center justify-center rounded-pill text-ink hover:bg-surface-3 md:hidden"
          >
            <span
              aria-hidden
              className={cx(
                "absolute h-px w-4 bg-current transition-transform duration-[var(--duration-base)] ease-snap",
                open ? "rotate-45" : "-translate-y-[3px]",
              )}
            />
            <span
              aria-hidden
              className={cx(
                "absolute h-px w-4 bg-current transition-transform duration-[var(--duration-base)] ease-snap",
                open ? "-rotate-45" : "translate-y-[3px]",
              )}
            />
          </button>
        </div>
      </nav>

      <div
        id="site-menu"
        hidden={!open}
        className="glass bg-[color-mix(in_oklab,var(--canvas)_98%,transparent)]! mx-auto mt-2 max-w-6xl rounded-[var(--radius-lg)] p-2 shadow-float md:hidden"
      >
        <ul className="flex flex-col">
          {NAV_LINKS.map((l, i) => {
            const active = isActive(pathname, l.href);
            return (
              <li
                key={l.href}
                className={cx("transition-[opacity,transform] duration-[var(--duration-slow)] ease-out", open ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0")}
                style={{ transitionDelay: `${i * 40}ms` }}
              >
                <Link
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cx(
                    "flex h-12 items-center rounded-[var(--radius-md)] px-4 font-display text-lg",
                    active ? "bg-surface-3 text-ink" : "text-ink-muted",
                  )}
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-line p-2 pt-3">{cta}</div>
      </div>
    </header>
  );
}
