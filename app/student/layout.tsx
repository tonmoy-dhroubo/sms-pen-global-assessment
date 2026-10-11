import { AppHeader } from "@/components/layout/app-header";
import { StudentTabs } from "@/components/layout/student-tabs";
import { toCurrentIdentity } from "@/components/session/current-identity";
import { requireStudentPage } from "@/lib/page-guards";

// Student area: header, tabs, page. Re-checks on the server that the student still exists (D-020); anyone else goes
// back to the role picker.
export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const identity = await requireStudentPage();

  return (
    <>
      <AppHeader identity={toCurrentIdentity(identity)} />
      <StudentTabs />
      <main id="main-content" className="mx-auto w-full max-w-5xl flex-1 p-4 md:p-6">
        {children}
      </main>
    </>
  );
}
