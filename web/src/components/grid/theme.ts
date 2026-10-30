import { colorSchemeDark, themeQuartz } from "ag-grid-community";

// zinc-950/900/800 surfaces, emerald-500 accent — matches the landing page.
export const gridTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: "#09090b",
  chromeBackgroundColor: "#18181b",
  oddRowBackgroundColor: "#0c0c0e",
  foregroundColor: "#e4e4e7",
  headerTextColor: "#a1a1aa",
  borderColor: "#27272a",
  accentColor: "#10b981",
  selectedRowBackgroundColor: "rgba(16, 185, 129, 0.12)",
  fontFamily: "inherit",
  fontSize: 13,
  spacing: 6,
  wrapperBorderRadius: 8,
});
