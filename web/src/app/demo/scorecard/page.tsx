import type { Metadata } from "next";
import Scorecard from "@/components/demo/Scorecard";

export const metadata: Metadata = { title: "Injection scorecard | CartHold" };

export default function ScorecardPage() {
  return <Scorecard />;
}
