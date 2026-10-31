export const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/demo", label: "Live demo" },
  { href: "/demo/scorecard", label: "Scorecard" },
  { href: "/stores", label: "Stores" },
] as const;

export const RECORDED_RUN_HREF = "/demo?fixture=1";

/** /stores/[slug] pages are fake third-party shops with their own header, footer and CartHold reveal pill. */
export const isStorePage = (pathname: string) => /^\/stores\/[^/]+/.test(pathname);
