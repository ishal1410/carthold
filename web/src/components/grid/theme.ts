import { colorSchemeDark, themeQuartz } from "ag-grid-community";

// Night Escrow tokens (globals.css). CSS vars, so the light theme follows data-theme on <html>.
export const gridTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: "var(--surface-1)",
  chromeBackgroundColor: "var(--surface-2)",
  oddRowBackgroundColor: "var(--surface-1)",
  rowHoverColor: "var(--surface-3)",
  foregroundColor: "var(--ink)",
  headerTextColor: "var(--ink-faint)",
  headerFontWeight: 500,
  borderColor: "var(--line)",
  rowBorder: { color: "var(--line)" },
  wrapperBorder: { color: "var(--line)" },
  columnBorder: false,
  accentColor: "var(--hold)",
  selectedRowBackgroundColor: "color-mix(in oklab, var(--hold) 10%, transparent)",
  fontFamily: "inherit",
  fontSize: 13,
  spacing: 7,
  wrapperBorderRadius: 14,
});
