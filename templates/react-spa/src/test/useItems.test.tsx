import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useItems } from "@/features/items/useItems";

// Controllable fake Axios client returned by the mocked AppConfig hook.
const get = vi.fn();
vi.mock("@/app/AppConfig", () => ({
  useApiClient: () => ({ get }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useItems", () => {
  it("starts in a loading state", () => {
    get.mockReturnValueOnce(new Promise(() => {}));
    const { result } = renderHook(() => useItems(), { wrapper });
    expect(result.current.isLoading).toBe(true);
  });

  it("returns Zod-parsed data on success", async () => {
    get.mockResolvedValueOnce({ data: [{ id: "1", name: "First" }] });
    const { result } = renderHook(() => useItems(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "1", name: "First" }]);
  });

  it("surfaces an error state when the request fails", async () => {
    get.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useItems(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
