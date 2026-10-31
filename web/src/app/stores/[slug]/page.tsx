import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStore, stores } from "@/data/stores";
import BrewAndBean from "../_ui/brew-and-bean";
import Giftlane from "../_ui/giftlane";
import QuickTech from "../_ui/quicktech";
import Northpine from "../_ui/northpine";
import { RevealControl } from "../_ui/reveal";

const views = { northpine: Northpine, "brew-and-bean": BrewAndBean, giftlane: Giftlane, quicktech: QuickTech };

export function generateStaticParams() {
  return stores.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata(props: PageProps<"/stores/[slug]">): Promise<Metadata> {
  const store = getStore((await props.params).slug);
  return store ? { title: `${store.featured.name} | ${store.name}`, description: store.tagline } : {};
}

export default async function StorePage(props: PageProps<"/stores/[slug]">) {
  const { slug } = await props.params;
  const store = getStore(slug);
  const View = views[slug as keyof typeof views];
  if (!store || !View) notFound();
  return (
    <>
      {/* Room so the floating control never covers the store footer, padded inside the store's own background. */}
      <div className="*:pb-20">
        <View store={store} />
      </div>
      <RevealControl hiddenCount={store.hidden.length} />
    </>
  );
}
