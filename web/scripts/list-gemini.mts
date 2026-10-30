// Lists Gemini model names available to the app's key (names only).
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=100", {
  headers: { "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
});
const body = await res.json();
console.log("status", res.status, body.error?.status ?? "");
for (const m of body.models ?? []) if (m.supportedGenerationMethods?.includes("generateContent")) console.log(m.name);
