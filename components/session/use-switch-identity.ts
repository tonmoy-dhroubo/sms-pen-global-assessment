"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { handleApiError } from "@/lib/client/api-errors";
import {
  clearSession,
  homePathFor,
  switchIdentity,
  type SwitchSessionInput,
} from "@/lib/client/session";

// Switching who the browser is viewing as (D-020): `PUT /api/session` sets the signed cookie, then we go to that
// role's home and refresh so every Server Component re-reads the new identity. "Change role" clears the cookie
// (`DELETE /api/session`) and goes back to the role picker at `/`.

/** `pendingId` while "Change role" is running. */
export const CHANGE_ROLE_PENDING = "change-role";

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

  /** Resolves `true` once the session is cleared and navigation to the role picker has started. */
  async function changeRole(): Promise<boolean> {
    setPendingId(CHANGE_ROLE_PENDING);
    try {
      await clearSession();
      router.push("/");
      router.refresh();
      return true;
    } catch (error) {
      handleApiError(error);
      return false;
    } finally {
      setPendingId(null);
    }
  }

  return { switchTo, changeRole, pendingId };
}
