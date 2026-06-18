import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/atoms/card";

// Rendered when environment configuration fails validation (FR-015). Shows the
// exact missing/invalid variables instead of a blank screen or a deep crash.
export function ConfigError({ issues }: { issues: string[] }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Configuration error</CardTitle>
          <CardDescription>
            The app cannot start because some required environment variables are missing or
            invalid. Copy <code>.env.example</code> to <code>.env</code> and fill in the values,
            then restart the dev server.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
