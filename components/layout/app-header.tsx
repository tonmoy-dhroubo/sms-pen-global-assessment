import Link from "next/link";
import { StaffMobileNav } from "@/components/layout/staff-nav";
import { StaffQuickSearch } from "@/components/layout/staff-quick-search";
import { RoleSwitcher } from "@/components/session/role-switcher";
import type { CurrentIdentity } from "@/components/session/current-identity";
import { ThemeToggle } from "@/components/theme/theme-toggle";

// The header on every page, both roles (pages.md "Global layout"): app name, global search (staff only), theme
// toggle, role switcher. Staff also get the menu button that opens the sidebar below md. Below md the search drops to
// a second row of its own, so it stays reachable on a phone.

export const APP_NAME = "Registry";

export function AppHeader({ identity }: { identity: CurrentIdentity | null }) {
  const isStaff = identity?.role === "staff";

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      <div className="flex min-h-14 flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2 md:gap-x-4 md:px-6 md:py-0">
        {isStaff ? <StaffMobileNav /> : null}
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md text-base font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
          >
            R
          </span>
          <span>{APP_NAME}</span>
        </Link>

        {isStaff ? (
          <div className="order-last w-full md:order-none md:mx-auto md:max-w-sm md:flex-1">
            <StaffQuickSearch />
          </div>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <RoleSwitcher current={identity} />
        </div>
      </div>
    </header>
  );
}
