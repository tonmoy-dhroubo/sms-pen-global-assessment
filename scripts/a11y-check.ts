import { readFileSync } from "node:fs";
import path from "node:path";
import { BASE_URL, findAssessment, findStudent, signIn, signInFirstStaff } from "./browser/app";
import type { Identity } from "./browser/app";
import { launchBrowser } from "./browser/cdp";
import type { Page } from "./browser/cdp";

// Automated accessibility check: runs axe-core on the main pages, signed in as the right role, in light and dark.
//
//   npm run services:up && npm run db:reset && npm run build && npm start     (in another terminal)
//   npm run a11y                       # all pages, both themes
//   npm run a11y -- --theme=dark       # one theme
//   npm run a11y -- --only=/staff/fees # pages whose path contains this text
//
// It drives a locally installed Chrome or Edge over the DevTools Protocol (see scripts/browser/cdp.ts) and injects
// `axe-core`, so there is no browser download and no Playwright dependency. Exit code 1 when any serious or critical
// violation is found; moderate and minor ones are listed but do not fail the run. Pass `--strict` to fail on those too.

interface Target {
  name: string;
  role: "staff" | "student" | "public";
  path: string;
  /** Clicks to make before checking, to cover tabs, dialogs and menus: a CSS selector and (optionally) the label it starts with. */
  steps?: Array<{ click: string; text?: string }>;
}

interface AxeNode {
  target: string[];
  html: string;
  failureSummary?: string;
}
interface AxeViolation {
  id: string;
  impact: "minor" | "moderate" | "serious" | "critical" | null;
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
}

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const themes = (flag("theme") ? [flag("theme")] : ["light", "dark"]) as Array<"light" | "dark">;
const only = flag("only");
const strict = args.includes("--strict");

const axeSource = readFileSync(
  path.join(import.meta.dirname, "..", "node_modules", "axe-core", "axe.min.js"),
  "utf8",
);

const IMPACT_ORDER = ["critical", "serious", "moderate", "minor"] as const;

async function check(page: Page): Promise<AxeViolation[]> {
  await page.evaluate(axeSource);
  return page.evaluate<AxeViolation[]>(`(async () => {
    const result = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
      resultTypes: ["violations"],
    });
    return result.violations.map((v) => ({
      id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl,
      nodes: v.nodes.map((n) => ({ target: n.target.map(String), html: n.html.slice(0, 220), failureSummary: n.failureSummary })),
    }));
  })()`);
}

async function main() {
  const staff = await signInFirstStaff();
  const tahmid = await findStudent("Tahmid");
  const student: Identity = await signIn("student", tahmid.id);
  const essay = await findAssessment(staff, "Essay 1");
  // Any assessment of Tahmid's programme works for the student detail page; Essay 1 has two of his file versions.
  const all: Target[] = [
    { name: "Role picker", role: "public", path: "/" },
    { name: "Staff dashboard", role: "staff", path: "/staff" },
    { name: "Student list", role: "staff", path: "/staff/students" },
    { name: "Student record", role: "staff", path: `/staff/students/${tahmid.id}` },
    { name: "New student", role: "staff", path: "/staff/students/new" },
    { name: "Fees overview", role: "staff", path: "/staff/fees" },
    { name: "Programmes", role: "staff", path: "/staff/programmes" },
    { name: "Assessments", role: "staff", path: "/staff/assessments" },
    { name: "Assessment (Submissions tab)", role: "staff", path: `/staff/assessments/${essay.id}` },
    {
      name: "Assessment (Marksheet tab)",
      role: "staff",
      path: `/staff/assessments/${essay.id}`,
      steps: [{ click: '[role="tab"]', text: "Marksheet" }],
    },
    { name: "New assessment", role: "staff", path: "/staff/assessments/new" },
    { name: "Edit student", role: "staff", path: `/staff/students/${tahmid.id}/edit` },
    {
      name: "Student list, no results",
      role: "staff",
      path: "/staff/students?q=zzzznomatch",
    },
    {
      name: "Record payment dialog",
      role: "staff",
      path: `/staff/students/${tahmid.id}`,
      steps: [{ click: "button", text: "Record payment" }],
    },
    {
      name: "Change status dialog",
      role: "staff",
      path: `/staff/students/${tahmid.id}`,
      steps: [{ click: "button", text: "Change status" }],
    },
    {
      name: "Publish preview dialog",
      role: "staff",
      path: `/staff/assessments/${essay.id}`,
      steps: [
        { click: '[role="tab"]', text: "Marksheet" },
        { click: "button", text: "Publish" },
      ],
    },
    {
      name: "Role switcher open",
      role: "staff",
      path: "/staff",
      steps: [{ click: "button", text: "Viewing as" }],
    },
    {
      name: "Quick search open",
      role: "staff",
      path: "/staff",
      steps: [{ click: "input[placeholder='Search students']" }],
    },
    { name: "Student overview", role: "student", path: "/student" },
    { name: "Student fees", role: "student", path: "/student/fees" },
    { name: "Student assessments", role: "student", path: "/student/assessments" },
    {
      name: "Student assessment",
      role: "student",
      path: `/student/assessments/${essay.id}`,
    },
    { name: "Student results", role: "student", path: "/student/results" },
  ];
  const targets = all.filter((t) => !only || t.path.includes(only));

  const browser = await launchBrowser();
  const summary: Array<{ name: string; theme: string; counts: Record<string, number> }> = [];
  let blocking = 0;
  try {
    for (const theme of themes) {
      for (const target of targets) {
        const page = await browser.newPage();
        try {
          await page.setViewport(1280, 900);
          await page.setColorScheme(theme);
          if (target.role !== "public") {
            await page.setCookie(
              "sms_role",
              (target.role === "staff" ? staff : student).cookie,
              BASE_URL,
            );
          }
          await page.navigate(`${BASE_URL}${target.path}`, 1200);
          for (const step of target.steps ?? []) await page.click(step.click, step.text);
          const violations = await check(page);
          const counts: Record<string, number> = {};
          for (const v of violations)
            counts[v.impact ?? "minor"] = (counts[v.impact ?? "minor"] ?? 0) + 1;
          summary.push({ name: target.name, theme, counts });

          const label = `${target.name} [${theme}] ${target.path}`;
          if (violations.length === 0) {
            console.log(`ok   ${label}`);
          }
          for (const v of [...violations].sort(
            (a, b) =>
              IMPACT_ORDER.indexOf(a.impact ?? "minor") - IMPACT_ORDER.indexOf(b.impact ?? "minor"),
          )) {
            const impact = v.impact ?? "minor";
            if (impact === "critical" || impact === "serious" || (strict && impact !== "minor"))
              blocking += 1;
            console.log(
              `${impact.toUpperCase().padEnd(8)} ${label}\n         ${v.id}: ${v.help} (${v.nodes.length})`,
            );
            for (const node of v.nodes.slice(0, 3)) {
              console.log(
                `           ${node.target.join(" ")}\n           ${node.html.replace(/\s+/g, " ")}`,
              );
              if (node.failureSummary) {
                console.log(
                  `           ${node.failureSummary.split("\n").slice(0, 3).join(" | ")}`,
                );
              }
            }
          }
        } finally {
          page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  const total = (impact: string) =>
    summary.reduce((sum, row) => sum + (row.counts[impact] ?? 0), 0);
  console.log(
    `\nChecked ${targets.length} pages x ${themes.length} theme(s). Violations: ` +
      IMPACT_ORDER.map((impact) => `${total(impact)} ${impact}`).join(", "),
  );
  if (blocking > 0) {
    console.error(`${blocking} blocking violation(s).`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
