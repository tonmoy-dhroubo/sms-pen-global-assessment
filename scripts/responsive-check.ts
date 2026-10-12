import { mkdirSync } from "node:fs";
import path from "node:path";
import { BASE_URL, findAssessment, findStudent, signIn, signInFirstStaff } from "./browser/app";
import type { Identity } from "./browser/app";
import { launchBrowser } from "./browser/cdp";

// Responsive check: opens every main page at 375, 768 and 1280 px and reports anything that makes the page itself
// scroll sideways (content wider than the screen). Tables that scroll inside their own box are fine and not reported.
//
//   npm start                                       (in another terminal, after `npm run build`)
//   npm run responsive                              # report only
//   npm run responsive -- --shots=docs/screenshots/m17   # also save a full-page PNG per page and width
//   npm run responsive -- --theme=dark --only=/staff/fees --width=375
//   npm run responsive -- --only=/staff/students/ --shots=out --section=Submissions   # one card only

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const widths = flag("width") ? [Number(flag("width"))] : [375, 768, 1280];
const theme = (flag("theme") ?? "light") as "light" | "dark";
const only = flag("only");
const shots = flag("shots");
const studentName = flag("student") ?? "Tahmid"; // whose record and portal the pages show
const section = flag("section"); // with --shots: capture only the card with this heading

interface Overflow {
  scrollWidth: number;
  clientWidth: number;
  offenders: string[];
}

async function main() {
  const staff = await signInFirstStaff();
  const tahmid = await findStudent(studentName);
  const student: Identity = await signIn("student", tahmid.id);
  const essay = await findAssessment(staff, "Essay 1");
  const all: Array<{ name: string; role: "staff" | "student" | "public"; path: string }> = [
    { name: "picker", role: "public", path: "/" },
    { name: "staff-dashboard", role: "staff", path: "/staff" },
    { name: "staff-students", role: "staff", path: "/staff/students" },
    { name: "staff-student-record", role: "staff", path: `/staff/students/${tahmid.id}` },
    { name: "staff-student-new", role: "staff", path: "/staff/students/new" },
    { name: "staff-student-edit", role: "staff", path: `/staff/students/${tahmid.id}/edit` },
    { name: "staff-fees", role: "staff", path: "/staff/fees" },
    { name: "staff-programmes", role: "staff", path: "/staff/programmes" },
    { name: "staff-assessments", role: "staff", path: "/staff/assessments" },
    { name: "staff-assessment-new", role: "staff", path: "/staff/assessments/new" },
    { name: "staff-assessment", role: "staff", path: `/staff/assessments/${essay.id}` },
    { name: "student-overview", role: "student", path: "/student" },
    { name: "student-fees", role: "student", path: "/student/fees" },
    { name: "student-assessments", role: "student", path: "/student/assessments" },
    { name: "student-assessment", role: "student", path: `/student/assessments/${essay.id}` },
    { name: "student-results", role: "student", path: "/student/results" },
  ];
  const pages = all.filter((p) => !only || p.path.includes(only));

  if (shots) mkdirSync(shots, { recursive: true });
  const browser = await launchBrowser();
  let problems = 0;
  try {
    for (const width of widths) {
      for (const target of pages) {
        const page = await browser.newPage();
        try {
          await page.setViewport(width, 900, width < 500);
          await page.setColorScheme(theme);
          if (target.role !== "public") {
            await page.setCookie(
              "sms_role",
              (target.role === "staff" ? staff : student).cookie,
              BASE_URL,
            );
          }
          await page.navigate(`${BASE_URL}${target.path}`, 1200);
          const result = await page.evaluate<Overflow>(`(() => {
            const root = document.documentElement;
            const offenders = [];
            if (root.scrollWidth > root.clientWidth) {
              for (const el of document.body.querySelectorAll("*")) {
                const r = el.getBoundingClientRect();
                if (r.right > root.clientWidth + 1 && r.width > 0) {
                  // Skip anything inside a box that scrolls sideways by itself.
                  let scroller = el.parentElement;
                  let inside = false;
                  while (scroller && scroller !== document.body) {
                    const overflow = getComputedStyle(scroller).overflowX;
                    if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") { inside = true; break; }
                    scroller = scroller.parentElement;
                  }
                  if (!inside) offenders.push(el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 3).join(".") : "") + " right=" + Math.round(r.right));
                }
              }
            }
            return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, offenders: offenders.slice(0, 6) };
          })()`);
          const sideways = result.scrollWidth > result.clientWidth;
          if (sideways) problems += 1;
          console.log(
            `${sideways ? "SIDEWAYS" : "ok      "} ${String(width).padStart(4)} ${target.name}` +
              (sideways
                ? ` (page ${result.scrollWidth}px in ${result.clientWidth}px) ${result.offenders.join("; ")}`
                : ""),
          );
          if (shots) {
            const file = path.join(
              shots,
              `${target.name}${section ? `-${section.toLowerCase()}` : ""}-${theme}-${width}.png`,
            );
            if (section)
              await page.screenshotSection(file, section).catch(() => undefined); // pages without the section are skipped
            else await page.screenshot(file, true);
          }
        } finally {
          page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  if (problems > 0) {
    console.error(`\n${problems} page(s) scroll sideways.`);
    process.exit(1);
  }
  console.log(`\nChecked ${pages.length} pages at ${widths.join(", ")} px: no sideways scrolling.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
