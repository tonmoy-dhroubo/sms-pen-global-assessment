import type { SessionOptions } from "@/lib/services/identity";
import type { SwitchSessionInput } from "@/lib/validation/session";
import { apiRequest } from "@/lib/client/api";

// Browser calls behind the role picker and the header role switcher (api.md "Session"). Type-only imports above:
// nothing server-side is bundled.

export type { SessionOptions, SwitchSessionInput };

export type SessionRoleName = "staff" | "student";

/** Where each role lands after switching (pages.md "Role switcher"). */
export function homePathFor(role: SessionRoleName): string {
  return role === "staff" ? "/staff" : "/student";
}

export function fetchSessionOptions(q: string, signal?: AbortSignal): Promise<SessionOptions> {
  const query = q.trim();
  const url = query
    ? `/api/session/options?q=${encodeURIComponent(query)}`
    : "/api/session/options";
  return apiRequest<SessionOptions>(url, { signal });
}

/** `PUT /api/session`: sets the role cookie. Resolves with the identity the server now sees. */
export function switchIdentity(target: SwitchSessionInput): Promise<{ role: SessionRoleName }> {
  return apiRequest<{ role: SessionRoleName }>("/api/session", { method: "PUT", body: target });
}
