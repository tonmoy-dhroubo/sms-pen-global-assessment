import Link from "next/link";
import { SearchIcon } from "lucide-react";
import { StaffMobileNav } from "@/components/layout/staff-nav";
import { RoleSwitcher } from "@/components/session/role-switcher";
import type { CurrentIdentity } from "@/components/session/current-identity";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

// The header on every page, both roles (pages.md "Global layout"): app name, global search (staff only), theme
// toggle, role switcher. Staff also get the menu button that opens the sidebar below md.

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
      <div className="flex h-14 items-center gap-2 px-4 md:gap-4 md:px-6">
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
          // Wired up in M16 (Ctrl+K quick search); until then it is a visible, disabled placeholder.
          <div className="mx-auto hidden w-full max-w-sm md:block" role="search">
            <InputGroup>
              <InputGroupInput
                disabled
                type="search"
                placeholder="Search students (coming soon)"
                aria-label="Search students (coming soon)"
              />
              <InputGroupAddon>
                <SearchIcon aria-hidden="true" />
              </InputGroupAddon>
            </InputGroup>
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
