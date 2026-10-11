import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { toCurrentIdentity } from "@/components/session/current-identity";
import { RolePicker } from "@/components/session/role-picker";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { homePathFor } from "@/lib/client/session";
import { listSessionOptions } from "@/lib/services/identity";
import { currentIdentity } from "@/lib/session";

export const metadata: Metadata = { title: "Choose who you are viewing as" };

// The role picker (pages.md "Public"): also where /staff and /student send anyone without a valid role cookie.
export default async function Home() {
  const [identity, options] = await Promise.all([currentIdentity(), listSessionOptions(undefined)]);
  const current = toCurrentIdentity(identity);

  return (
    <>
      <AppHeader identity={current} />
      <main id="main-content" className="mx-auto w-full max-w-5xl flex-1 space-y-8 p-4 md:p-6">
        <PageHeader
          title="Who are you viewing as?"
          description="There is no login in this demo. Pick a Registry staff member or a student to see the app from their side; you can switch at any time from the header."
        />

        {current ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/50 p-4 ring-1 ring-foreground/10">
            <p className="text-sm">
              You are currently viewing as{" "}
              <strong className="font-medium">{current.fullName}</strong>.
            </p>
            <Link
              href={homePathFor(current.role)}
              className={buttonVariants({ variant: "outline" })}
            >
              Continue
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </Link>
          </div>
        ) : null}

        <RolePicker initial={options} />
      </main>
    </>
  );
}
