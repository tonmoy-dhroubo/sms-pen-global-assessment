"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { STUDENT_NAV, isActivePath } from "@/components/layout/nav-config";
import { cn } from "@/lib/utils";

// The student's tabs under the header (pages.md): Overview, Fees, Assessments, Results. These are links between
// routes, so they are a navigation landmark with `aria-current`, not an ARIA tablist.

export function StudentTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Student sections" className="border-b bg-background">
      <ul className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 md:px-6">
        {STUDENT_NAV.map((item) => {
          const active = isActivePath(pathname, item);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-11 items-center px-3 text-sm font-medium transition-colors outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
                {active ? (
                  <span
                    className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary"
                    aria-hidden="true"
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
