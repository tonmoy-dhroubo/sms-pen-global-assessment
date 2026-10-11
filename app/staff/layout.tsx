import { AppHeader } from "@/components/layout/app-header";
import { StaffSidebar } from "@/components/layout/staff-nav";
import { toCurrentIdentity } from "@/components/session/current-identity";
import { requireStaffPage } from "@/lib/page-guards";

// Staff area: header, sidebar, page. `proxy.ts` only checks the cookie's signature and role; this re-checks that the
// staff member still exists (D-020), and sends anyone else back to the role picker.
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const identity = await requireStaffPage();

  return (
    <>
      <AppHeader identity={toCurrentIdentity(identity)} />
      <div className="flex flex-1">
        <StaffSidebar />
        <main id="main-content" className="min-w-0 flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>
    </>
  );
}
