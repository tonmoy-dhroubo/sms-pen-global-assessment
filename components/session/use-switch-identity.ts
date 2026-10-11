"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { handleApiError } from "@/lib/client/api-errors";
import { homePathFor, switchIdentity, type SwitchSessionInput } from "@/lib/client/session";

// Switching who the browser is viewing as (D-020): `PUT /api/session` sets the signed cookie, then we go to that
// role's home and refresh so every Server Component re-reads the new identity.

export function useSwitchIdentity() {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  /** Resolves `true` once the switch succeeded and navigation has started; `false` after an error toast. */
  async function switchTo(target: SwitchSessionInput): Promise<boolean> {
    setPendingId(target.role === "staff" ? target.staffId : target.studentId);
    try {
      const identity = await switchIdentity(target);
      router.push(homePathFor(identity.role));
      router.refresh();
      return true;
    } catch (error) {
      handleApiError(error);
      return false;
    } finally {
      setPendingId(null);
    }
  }

  return { switchTo, pendingId };
}
