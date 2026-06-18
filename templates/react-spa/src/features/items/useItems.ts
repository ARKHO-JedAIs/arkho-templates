import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/app/AppConfig";
import { type Item, itemListSchema } from "@/features/items/itemSchema";

// Example data hook: fetches through the shared Axios client and validates the
// response with Zod before returning typed data. Loading/error/empty states are
// derived from the React Query status by consumers.
export function useItems() {
  const apiClient = useApiClient();

  return useQuery<Item[]>({
    queryKey: ["items"],
    queryFn: async () => {
      const response = await apiClient.get("/items");
      return itemListSchema.parse(response.data);
    },
  });
}
