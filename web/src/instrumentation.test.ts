import { afterEach, expect, it, vi } from "vitest";
import { registerSigterm as register } from "./instrumentation-node";

const g = globalThis as unknown as { __cartholdSigterm?: boolean; __cartholdVoidAll?: () => Promise<unknown> };

afterEach(() => {
  delete g.__cartholdSigterm;
  delete g.__cartholdVoidAll;
  vi.restoreAllMocks();
});

it("SIGTERM voids held authorizations, then exits 143; registers once", async () => {
  const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  const voidAll = vi.fn(async () => undefined);
  g.__cartholdVoidAll = voidAll;
  const before = process.listenerCount("SIGTERM");
  register();
  register();
  expect(process.listenerCount("SIGTERM")).toBe(before + 1);
  process.emit("SIGTERM");
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(143));
  expect(voidAll).toHaveBeenCalledOnce();
});

it("SIGTERM still exits 143 when the sweep rejects", async () => {
  const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  const voidAll = vi.fn(async () => {
    throw new Error("paypal down");
  });
  g.__cartholdVoidAll = voidAll;
  register();
  process.emit("SIGTERM");
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(143));
  expect(voidAll).toHaveBeenCalledOnce();
});

it("SIGTERM still exits 143 when the sweep throws synchronously", async () => {
  const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  g.__cartholdVoidAll = () => {
    throw new Error("sync");
  };
  register();
  process.emit("SIGTERM");
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(143));
});

it("SIGTERM still exits 143 when session never loaded (no sweep published)", async () => {
  const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  register();
  process.emit("SIGTERM");
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(143));
});
