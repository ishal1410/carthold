import { connection } from "next/server";
import { getPageText, getStore } from "../../../../../data/stores";
import { fail, json } from "../../../../../lib/run/http";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await ctx.params;
  const store = getStore(slug);
  if (!store) return fail(404, "unknown store");
  return json({ slug, merchant: store.name, text: getPageText(slug) });
}
