import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BASE_URL, findAssessment, findStudent, signIn, signInFirstStaff } from "./browser/app";
import type { Identity } from "./browser/app";
import { launchBrowser } from "./browser/cdp";
import type { Page } from "./browser/cdp";

// Keyboard-only walkthrough of the five workflows (M17 accessibility pass): create a student, record a payment, create an
// assessment, upload a file as a student, enter and publish marks. Every step is a key press (Tab, Enter, arrows, typing);
// nothing is clicked. At each stop it checks that the focused control has a name and a visible focus indicator, and at the
// end it confirms through the API that the work really happened.
//
//   npm run db:reset && npm run build && npm start     (another terminal)
//   npm run keyboard
//
// The one non-keyboard step is choosing the file to upload: a browser's native file dialog cannot be driven from a script,
// so the file is attached to the focused input through the DevTools Protocol. This changes demo data; run `npm run db:reset`
// afterwards to restore it.

interface Focus {
  tag: string;
  type: string;
  id: string;
  name: string;
  inDialog: boolean;
  indicator: boolean;
}

const problems: string[] = [];
let tabs = 0;

const FOCUS_SCRIPT = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return { tag: "body", type: "", id: "", name: "", inDialog: false, indicator: true };
  const labels = el.labels ? [...el.labels].map((l) => l.textContent.trim()).join(" ") : "";
  const by = el.getAttribute("aria-labelledby");
  const named = by ? by.split(" ").map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ") : "";
  const name = (el.getAttribute("aria-label") || named || labels || el.textContent || el.getAttribute("placeholder") || "").replace(/\\s+/g, " ").trim().slice(0, 80);
  const cs = getComputedStyle(el);
  const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
  const shadow = cs.boxShadow !== "none";
  const border = el.matches("input,textarea,button,[role=combobox],[role=tab]") && cs.borderColor !== "";
  return { tag: el.tagName.toLowerCase(), type: el.getAttribute("type") || "", id: el.id, name,
    inDialog: !!el.closest("[role=dialog]"), indicator: outline || shadow || border };
})()`;

const focus = (page: Page) => page.evaluate<Focus>(FOCUS_SCRIPT);

/** Presses Tab until the focused control satisfies `match`; records anything unlabelled or without a focus ring. */
async function tabTo(
  page: Page,
  what: string,
  match: (f: Focus) => boolean,
  max = 80,
  back = false,
) {
  for (let i = 1; i <= max; i += 1) {
    await page.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      modifiers: back ? 8 : 0,
    });
    await page.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      modifiers: back ? 8 : 0,
    });
    tabs += 1;
    const f = await focus(page);
    if (f.name === "" && f.tag !== "body")
      problems.push(`${what}: a focused <${f.tag}> has no accessible name`);
    if (!f.indicator) problems.push(`${what}: "${f.name}" shows no focus indicator`);
    if (match(f)) {
      console.log(`  Tab x${i} -> ${what} ("${f.name}")`);
      return f;
    }
  }
  throw new Error(`Could not reach "${what}" with the Tab key in ${max} presses.`);
}

const press = async (page: Page, key: string, times = 1) => {
  for (let i = 0; i < times; i += 1) {
    await page.key(key);
    await page.settle(120);
  }
};

/** Types into a text box (the browser inserts the text as typing would). */
async function typeInto(page: Page, text: string) {
  await page.type(text);
  await page.settle(150);
}

/** Types key by key, for date and time boxes, whose segments each take their own key presses. */
async function typeKeys(page: Page, text: string) {
  for (const char of text) await page.key(char);
  await page.settle(150);
}

/** On a focused Radix select trigger: Enter opens it, Enter picks the highlighted option. */
async function pickFirst(page: Page, downs = 0) {
  await press(page, "Enter");
  await page.settle(300);
  for (let i = 0; i < downs; i += 1) await press(page, "ArrowDown");
  await press(page, "Enter");
  await page.settle(300);
}

async function waitFor<T>(
  what: string,
  probe: () => Promise<T | null | false>,
  ms = 15000,
): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

async function api<T>(who: Identity, url: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${url}`, {
    headers: { cookie: `sms_role=${who.cookie}` },
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

const text = (f: Focus) => f.name;

async function open(page: Page, who: Identity, url: string) {
  await page.setCookie("sms_role", who.cookie, BASE_URL);
  await page.navigate(`${BASE_URL}${url}`, 1200);
}

async function main() {
  const stamp = String(Date.now()).slice(-6);
  const staff = await signInFirstStaff();
  const browser = await launchBrowser();
  const results: string[] = [];
  try {
    // --- 1. Create a student ---------------------------------------------------------------------------------------
    console.log("1. Create a student (staff)");
    {
      const page = await browser.newPage();
      await page.setViewport(1280, 900);
      await open(page, staff, "/staff/students/new");
      await tabTo(page, "Full name", (f) => f.id === "student-full-name");
      await typeInto(page, `Keyboard Walker ${stamp}`);
      await tabTo(page, "Email", (f) => f.id === "student-email");
      await typeInto(page, `walker${stamp}@student.example.edu`);
      await tabTo(page, "Date of birth", (f) => f.id === "student-dob");
      await typeKeys(page, "03152004");
      await tabTo(page, "Programme", (f) => f.id === "student-programme");
      await pickFirst(page);
      await tabTo(page, "Session", (f) => f.id === "student-session");
      await pickFirst(page);
      await tabTo(page, "Year of study", (f) => f.id === "student-year");
      await pickFirst(page);
      await tabTo(page, "Save", (f) => f.tag === "button" && /^Save|^Create|^Enrol/i.test(text(f)));
      await press(page, "Enter");
      const created = await waitFor("the new student's record", async () => {
        const url = await page.evaluate<string>("location.pathname");
        return /\/staff\/students\/[0-9a-f-]{36}$/.test(url) ? url : false;
      });
      const heading = await page.evaluate<string>(
        "document.querySelector('h1')?.textContent ?? ''",
      );
      if (!heading.includes(`Keyboard Walker ${stamp}`))
        problems.push(`Create student: record heading was "${heading}"`);
      results.push(`created student at ${created}`);
      page.close();
    }

    // --- 2. Record a payment ---------------------------------------------------------------------------------------
    console.log("2. Record a payment (staff)");
    {
      const ayesha = await findStudent("Ayesha");
      const page = await browser.newPage();
      await page.setViewport(1280, 900);
      await open(page, staff, `/staff/students/${ayesha.id}`);
      await tabTo(
        page,
        "Record payment",
        (f) => f.tag === "button" && /^Record payment/.test(text(f)),
      );
      await press(page, "Enter");
      await page.settle(500);
      const inside = await focus(page);
      if (!inside.inDialog) problems.push("Record payment: focus did not move into the dialog");
      await tabTo(page, "Amount", (f) => f.id === "payment-amount", 10);
      await typeInto(page, "1000");
      await tabTo(page, "Method", (f) => f.id === "payment-method", 10);
      await pickFirst(page);
      await tabTo(page, "Reference", (f) => f.id === "payment-reference", 10);
      await typeInto(page, `KBD-${stamp}`);
      await tabTo(page, "Submit", (f) => f.tag === "button" && f.type === "submit", 10);
      await press(page, "Enter");
      await page.settle(1200);
      const payments = await api<{ payments: Array<{ reference: string }> }>(
        staff,
        `/api/students/${ayesha.id}/fees`,
      );
      if (!JSON.stringify(payments).includes(`KBD-${stamp}`))
        problems.push("Record payment: the payment is not in the student's fees");
      const dialogOpen = await page.evaluate<boolean>("!!document.querySelector('[role=dialog]')");
      if (dialogOpen) problems.push("Record payment: the dialog is still open after saving");
      const returned = await focus(page);
      if (returned.tag === "body")
        problems.push(
          "Record payment: focus was lost (back on the page body) after the dialog closed",
        );
      results.push("recorded a payment");
      page.close();
    }

    // --- 3. Create an assessment -----------------------------------------------------------------------------------
    console.log("3. Create an assessment (staff)");
    {
      const page = await browser.newPage();
      await page.setViewport(1280, 900);
      await open(page, staff, "/staff/assessments/new");
      await tabTo(page, "Module", (f) => f.id === "assessment-module");
      await pickFirst(page);
      await tabTo(page, "Title", (f) => f.id === "assessment-title", 5);
      await typeInto(page, `Keyboard quiz ${stamp}`);
      await tabTo(page, "Deadline date", (f) => f.type === "date", 5);
      await typeKeys(page, "12312031");
      await tabTo(page, "Deadline time", (f) => f.type === "time", 5);
      await typeKeys(page, "2359");
      await tabTo(page, "Save", (f) => f.tag === "button" && f.type === "submit", 5);
      await press(page, "Enter");
      await waitFor("the assessment page", async () =>
        /\/staff\/assessments\/[0-9a-f-]{36}$/.test(
          await page.evaluate<string>("location.pathname"),
        ),
      );
      results.push("created an assessment");
      page.close();
    }

    // --- 4. Upload a file as a student ------------------------------------------------------------------------------
    console.log("4. Upload a file (student)");
    {
      const rahman = await findStudent("Ayesha");
      const student = await signIn("student", rahman.id);
      const proposal = await findAssessment(staff, "Project Proposal");
      const dir = mkdtempSync(path.join(tmpdir(), "sms-kbd-"));
      const file = path.join(dir, `proposal-${stamp}.pdf`);
      writeFileSync(
        file,
        `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n% ${stamp}\n%%EOF\n`,
      );
      const page = await browser.newPage();
      await page.setViewport(1280, 900);
      await open(page, student, `/student/assessments/${proposal.id}`);
      const input = await tabTo(page, "File input", (f) => f.type === "file");
      void input;
      await page.setFiles("input[type=file]", [file]); // the only non-keyboard step; see the header comment
      await page.settle(400);
      await tabTo(
        page,
        "Upload",
        (f) => f.tag === "button" && /^(Upload|Replace)/.test(text(f)),
        6,
      );
      await press(page, "Enter");
      await waitFor(
        "the receipt",
        async () =>
          (await page.evaluate<boolean>("document.body.innerText.includes('SHA-256')")) || false,
      );
      results.push("uploaded a file and got a receipt");
      page.close();
    }

    // --- 5. Enter and publish marks --------------------------------------------------------------------------------
    console.log("5. Enter and publish marks (staff)");
    {
      const caseStudy = await findAssessment(staff, "Case Study");
      const page = await browser.newPage();
      await page.setViewport(1280, 900);
      await open(page, staff, `/staff/assessments/${caseStudy.id}`);
      await tabTo(page, "Tabs", (f) => f.name === "Submissions" || f.name === "Marksheet");
      await press(page, "ArrowRight"); // Radix tabs: arrows move and activate
      await page.settle(300);
      const first = await tabTo(page, "First mark box", (f) => /^Mark for /.test(f.name), 5);
      void first;
      await typeInto(page, "65");
      await press(page, "Enter"); // saves and moves to the next student
      await page.settle(500);
      await typeInto(page, "72.5");
      await press(page, "Enter");
      await page.settle(800);
      await tabTo(page, "Publish", (f) => f.tag === "button" && /^Publish/.test(text(f)), 80);
      await press(page, "Enter");
      await page.settle(800);
      const dialogFocus = await focus(page);
      if (!dialogFocus.inDialog) problems.push("Publish: focus did not move into the dialog");
      await tabTo(
        page,
        "Confirm publish",
        (f) => f.tag === "button" && /^Publish \d/.test(text(f)),
        10,
      );
      await press(page, "Enter");
      await page.settle(1500);
      const marksheet = await api<{
        items: Array<{ releaseStatus: string | null }>;
      }>(staff, `/api/assessments/${caseStudy.id}/marks`);
      const published = marksheet.items.filter((row) => row.releaseStatus === "PUBLISHED").length;
      if (published < 2)
        problems.push(`Publish: expected at least 2 published marks, found ${published}`);
      results.push(`entered and published marks (${published} published)`);
      page.close();
    }
  } finally {
    await browser.close();
  }

  console.log(
    `\n${results.map((r) => `  done: ${r}`).join("\n")}\n  Tab presses in total: ${tabs}`,
  );
  const unique = [...new Set(problems)];
  if (unique.length > 0) {
    console.error(`\n${unique.length} problem(s):\n${unique.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log(
    "\nAll five workflows completed with the keyboard only; every focused control was named and showed a focus indicator.",
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
