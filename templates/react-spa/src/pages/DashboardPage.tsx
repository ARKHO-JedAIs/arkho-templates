import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/atoms/card";
import { useAuth } from "@/features/auth/useAuth";

// Protected example screen. Reachable only through the RequireAuth guard.
export function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Dashboard</CardTitle>
          <CardDescription>This route is protected by authentication.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Signed in as <strong>{user?.username ?? "unknown"}</strong>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
