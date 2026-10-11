import { route } from "@/lib/api/handler";
import { canSubmitFor, getMyProfile } from "@/lib/services/me";

// The signed-in student's profile and what they may do. Staff get 403, no session gets 401.
export const GET = route({ access: "student" }, async ({ identity }) => {
  const profile = await getMyProfile(identity.student.id);
  return { student: profile, canSubmit: canSubmitFor(profile.status) };
});
