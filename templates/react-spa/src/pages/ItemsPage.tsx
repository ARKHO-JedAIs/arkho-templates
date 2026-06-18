import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/atoms/card";
import { useItems } from "@/features/items/useItems";

// Example data screen: exercises the Axios + React Query + Zod pattern and
// renders explicit loading, error, empty, and success states (FR-007).
export function ItemsPage() {
  const { data, isLoading, isError, error } = useItems();

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
          <CardDescription>Fetched from the backend API via the shared client.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">Loading items...</p> : null}

          {isError ? (
            <p className="text-sm text-destructive">
              Could not load items: {error instanceof Error ? error.message : "unknown error"}
            </p>
          ) : null}

          {!isLoading && !isError && data && data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items yet.</p>
          ) : null}

          {!isLoading && !isError && data && data.length > 0 ? (
            <ul className="space-y-2">
              {data.map((item) => (
                <li key={item.id} className="rounded-md border p-3">
                  <p className="font-medium">{item.name}</p>
                  {item.description ? (
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
