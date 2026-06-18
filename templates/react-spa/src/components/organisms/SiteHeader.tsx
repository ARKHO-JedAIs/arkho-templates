import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/atoms/button";
import { useAuth } from "@/features/auth/useAuth";

// Organism: top navigation bar. Shows auth-aware actions composed from atoms.
export function SiteHeader() {
  const { status, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/signin");
  };

  return (
    <header className="border-b">
      <div className="container flex h-14 items-center justify-between">
        <nav className="flex items-center gap-4 text-sm font-medium">
          <Link to="/">Home</Link>
          <Link to="/items">Items</Link>
          <Link to="/dashboard">Dashboard</Link>
        </nav>
        <div className="flex items-center gap-2">
          {status === "authenticated" ? (
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              Sign out
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link to="/signin">Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
