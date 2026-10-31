import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fixtureState } from "./fixtures";
import { VerdictStack } from "./Verdicts";

// A tab without the run's owner token must not offer working Approve/Reject buttons.
const render = (viewOnly: boolean) =>
  renderToStaticMarkup(
    createElement(VerdictStack, { guard: fixtureState(), busy: {}, simulated: true, viewOnly, onDecide: () => {}, onReveal: () => {} }),
  );
const decisionButtons = (html: string) => html.match(/<button[^>]*>(?:(?!<\/button>).)*?(Approve|Reject)/g) ?? [];

describe("VerdictStack view-only", () => {
  it("disables Approve and Reject and says why when viewOnly", () => {
    const html = render(true);
    const buttons = decisionButtons(html);
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    for (const b of buttons) expect(b).toMatch(/\sdisabled=""/);
    expect(html).toContain("View only.");
  });

  it("owner tab gets enabled buttons and no view-only note", () => {
    const html = render(false);
    const buttons = decisionButtons(html);
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    for (const b of buttons) expect(b).not.toMatch(/\sdisabled=""/);
    expect(html).not.toContain("View only.");
  });
});
