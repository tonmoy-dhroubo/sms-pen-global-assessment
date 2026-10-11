import { route } from "@/lib/api/handler";
import { getDashboard } from "@/lib/services/dashboard";

// Staff only. The Registry's morning view: KPI counts, fee ageing, the longest-overdue students and what needs attention.
export const GET = route({ access: "staff" }, () => getDashboard());
