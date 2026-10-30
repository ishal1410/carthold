// Pings Gemini with the app's env; prints only the HTTP status and reply text.
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${process.argv[2] ?? "gemini-flash-lite-latest"}:generateContent`,
  {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
    body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with the single word OK." }] }] }),
  },
);
const body = await res.json();
console.log("status", res.status, body.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? body.error?.status ?? "");
