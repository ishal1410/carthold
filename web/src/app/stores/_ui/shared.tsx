import { Archivo, Barlow, Barlow_Condensed, Plus_Jakarta_Sans, Work_Sans, Young_Serif } from "next/font/google";
import { DEMO_FOOTER, hiddenIn, type HiddenSlot, type Store } from "@/data/stores";

export const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "700"] });
export const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600"] });
export const youngSerif = Young_Serif({ subsets: ["latin"], weight: "400" });
export const workSans = Work_Sans({ subsets: ["latin"] });
export const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"] });
export const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"] });

/** Text-based hidden payloads for a slot (aria-label payloads go on the product art instead). */
export function Hidden({ store, slot }: { store: Store; slot: HiddenSlot }) {
  return hiddenIn(store, slot).map((h, i) =>
    h.style === "white-on-white" ? (
      // ponytail: relies on the surrounding surface being #fff, which is true on Giftlane
      <p key={i} data-hidden-style={h.style} className="text-[2px] leading-[2px] text-white">
        {h.text}
      </p>
    ) : h.style === "visually-hidden" ? (
      <span key={i} data-hidden-style={h.style} className="sr-only">
        {h.text}
      </span>
    ) : null,
  );
}

/** aria-label for the product art: an injected label if the store has one, else an honest description. */
export function artLabel(store: Store, fallback: string) {
  return hiddenIn(store, "image").find((h) => h.style === "aria-label")?.text ?? fallback;
}

export function DemoFooter({ className = "" }: { className?: string }) {
  return <p className={`py-6 text-center text-xs opacity-60 ${className}`}>{DEMO_FOOTER}</p>;
}
