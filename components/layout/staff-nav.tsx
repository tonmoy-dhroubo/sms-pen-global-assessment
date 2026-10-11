"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { STAFF_NAV, isActivePath } from "@/components/layout/nav-config";
import { cn } from "@/lib/utils";

// The staff sidebar (pages.md): Dashboard, Students, Fees, Assessments, Programmes. At md and wider it is a fixed
// column beside the page; below that it lives in a Sheet opened from the header's menu button.

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {STAFF_NAV.map((item) => {
        const active = isActivePath(pathname, item);
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              {Icon ? (
                <Icon
                  className={cn("size-4", active && "text-sidebar-primary")}
                  aria-hidden="true"
                />
              ) : null}
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The permanent sidebar, shown from md upward. */
export function StaffSidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-sidebar text-sidebar-foreground md:block">
      <nav aria-label="Staff" className="sticky top-14 p-3">
        <NavLinks />
      </nav>
    </aside>
  );
}

/** The menu button and Sheet that replace the sidebar below md. */
export function StaffMobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="md:hidden" aria-label="Open menu">
          <MenuIcon aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 bg-sidebar p-0 text-sidebar-foreground">
        <SheetHeader className="border-b">
          <SheetTitle>Registry</SheetTitle>
          <SheetDescription>Staff navigation</SheetDescription>
        </SheetHeader>
        <nav aria-label="Staff" className="p-3">
          <NavLinks onNavigate={() => setOpen(false)} />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
