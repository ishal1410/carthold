// Tests must never reach real Gemini or PayPal: drop any keys inherited from the shell.
// Tests that need a value set it themselves (vi.stubEnv / process.env assignment).
for (const k of ["GEMINI_API_KEY", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]) delete process.env[k];

// Any unmocked network call fails loudly instead of silently hitting a real API.
globalThis.fetch = (async (input: unknown) => {
  throw new Error(`network disabled in tests: ${String(input)}`);
}) as typeof fetch;
