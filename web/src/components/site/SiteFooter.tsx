"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_LINKS, README_HREF, RECORDED_RUN_HREF, REPO_HREF, isStorePage } from "./links";
import { Wordmark } from "./Wordmark";

export function SiteFooter() {
  const pathname = usePathname() ?? "/";
  if (isStorePage(pathname)) return null;
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-12 md:px-6">
        <div className="md:col-span-6">
          <Wordmark />
          <p className="mt-4 max-w-sm text-sm text-pretty text-ink-muted">
            A payment hold between an AI shopping agent and your money. Built for the PayPal AI hackathon. Everything
            runs on the PayPal sandbox, so no real money moves.
          </p>
        </div>
        <nav aria-label="Footer" className="md:col-span-3">
          <h2 className="text-sm font-medium text-ink">Product</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-ink-muted hover:text-ink">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="md:col-span-3">
          <h2 className="text-sm font-medium text-ink">See it work</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href={RECORDED_RUN_HREF} className="text-ink-muted hover:text-ink">
                Recorded run
              </Link>
            </li>
            <li>
              <Link href="/#injection" className="text-ink-muted hover:text-ink">
                Hidden text, revealed
              </Link>
            </li>
            <li>
              <Link href="/#honesty" className="text-ink-muted hover:text-ink">
                What is real here
              </Link>
            </li>
            <li>
              <a href={REPO_HREF} className="text-ink-muted hover:text-ink">
                Source on GitHub
              </a>
            </li>
            <li>
              <a href={README_HREF} className="text-ink-muted hover:text-ink">
                How to test (README)
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-ink-faint md:px-6">
          Demo stores are fictional. PayPal is used in sandbox mode only.
        </p>
      </div>
    </footer>
  );
}
