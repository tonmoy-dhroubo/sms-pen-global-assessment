import Link from "next/link";
import { FileQuestionIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main-content" className="mx-auto w-full max-w-2xl flex-1 p-4 md:p-6">
      <EmptyState
        icon={FileQuestionIcon}
        title="Page not found"
        description="This page does not exist, or you do not have access to it."
        action={
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            Back to the start
          </Link>
        }
      />
    </main>
  );
}
