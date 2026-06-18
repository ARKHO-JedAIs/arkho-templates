import { Outlet } from "react-router-dom";
import { SiteHeader } from "@/components/organisms/SiteHeader";

// Page-level layout (atomic-design "template"): header plus the routed outlet.
export function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="container py-8">
        <Outlet />
      </main>
    </div>
  );
}
