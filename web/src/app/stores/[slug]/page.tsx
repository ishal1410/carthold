import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStore, stores } from "@/data/stores";
import BrewAndBean from "../_ui/brew-and-bean";
import GiftHub from "../_ui/gifthub";
import QuickTech from "../_ui/quicktech";
import Trailhead from "../_ui/trailhead";

const views = { trailhead: Trailhead, "brew-and-bean": BrewAndBean, gifthub: GiftHub, quicktech: QuickTech };

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
  return <View store={store} />;
}
