import { Button } from "@/components/atoms/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/atoms/card";
import { useUiStore } from "@/features/ui/uiStore";

// Public example screen built from design-system components. Demonstrates the
// Zustand client store via the theme toggle.
export function HomePage() {
  const theme = useUiStore((state) => state.theme);
  const toggleTheme = useUiStore((state) => state.toggleTheme);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
          <CardDescription>
            This frontend was scaffolded from the ARKHO <code>react-spa</code> template.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Current theme preference (from the Zustand store): <strong>{theme}</strong>
          </p>
          <Button onClick={toggleTheme}>Toggle theme</Button>
        </CardContent>
      </Card>
    </div>
  );
}
