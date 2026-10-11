import {
  ClipboardListIcon,
  GraduationCapIcon,
  LayoutDashboardIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

// Navigation entries (pages.md "Global layout"): the staff sidebar and the student tabs.

export interface NavItem {
  href: string;
  label: string;
  icon?: LucideIcon;
  /** Active only on this exact path (the section home), not on its children. */
  exact?: boolean;
}

export const STAFF_NAV: readonly NavItem[] = [
  { href: "/staff", label: "Dashboard", icon: LayoutDashboardIcon, exact: true },
  { href: "/staff/students", label: "Students", icon: UsersIcon },
  { href: "/staff/fees", label: "Fees", icon: WalletIcon },
  { href: "/staff/assessments", label: "Assessments", icon: ClipboardListIcon },
  { href: "/staff/programmes", label: "Programmes", icon: GraduationCapIcon },
];

export const STUDENT_NAV: readonly NavItem[] = [
  { href: "/student", label: "Overview", exact: true },
  { href: "/student/fees", label: "Fees" },
  { href: "/student/assessments", label: "Assessments" },
  { href: "/student/results", label: "Results" },
];

export function isActivePath(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
