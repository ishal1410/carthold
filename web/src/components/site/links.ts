export const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/demo", label: "Demo" },
  { href: "/demo/scorecard", label: "Scorecard" },
  { href: "/stores", label: "Stores" },
] as const;

export const RECORDED_RUN_HREF = "/demo?fixture=1";

// ponytail: hand-copied from src/data/stores.ts so the nav doesn't ship store data to every page; links.test.ts checks they match.
export const STORE_SLUGS = ["northpine", "brew-and-bean", "giftlane", "quicktech"] as const;
/** /stores/[slug] pages are fake third-party shops with their own header, footer and CartHold reveal pill.
 *  Only real slugs count: an unknown /stores/x is a 404 and keeps the site nav and footer. */
export const isStorePage = (pathname: string) =>
  (STORE_SLUGS as readonly string[]).includes(pathname.split("/")[2] ?? "") && pathname.startsWith("/stores/");

// Text links only, no GitHub logo.
export const REPO_HREF = "https://github.com/ishal1410/carthold";
export const README_HREF = `${REPO_HREF}#how-to-test`;
