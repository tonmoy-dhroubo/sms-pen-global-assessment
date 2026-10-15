import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BASE_URL, findAssessment, findStudent, signIn, signInFirstStaff } from "./browser/app";
import type { Identity } from "./browser/app";
import { launchBrowser } from "./browser/cdp";
import type { Page } from "./browser/cdp";

// End-to-end check of the three hand-offs between staff and students, through the real UI in a real browser:
//   1. staff records a payment                -> the student sees the payment and a lower balance
//   2. the student uploads a file             -> staff sees the submission on the student record and the assessment
//   3. staff enters a mark and publishes it   -> the student sees the result
//
//   npm run db:reset && npm run build && npm start     (another terminal)
//   npm run e2e
//
// It drives a locally installed Chrome or Edge over the DevTools Protocol (scripts/browser/cdp.ts), so there is nothing
// to download. It changes demo data (a payment, a file, a mark); run `npm run db:reset` afterwards to restore it.

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  console.log(`  ${condition ? "ok  " : "FAIL"} ${message}`);
  if (!condition) failures.push(message);
};

async function api<T>(who: Identity, url: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${url}`, {
    headers: { cookie: `sms_role=${who.cookie}` },
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

async function open(page: Page, who: Identity, url: string) {
  await page.setCookie("sms_role", who.cookie, BASE_URL);
  await page.navigate(`${BASE_URL}${url}`, 1200);
}

const bodyText = (page: Page) => page.evaluate<string>("document.body.innerText");

async function waitForText(page: Page, text: string, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if ((await bodyText(page)).includes(text)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

interface MySubmission {
  assessment: { submission: { currentFile: { id: string; sizeBytes: number } } | null };
}

interface MyFees {
  summary: { balance: string };
  payments: Array<{ reference: string; amount: string }>;
}

async function main() {
  const stamp = String(Date.now()).slice(-6);
  const staff = await signInFirstStaff();
  const ayesha = await findStudent("Ayesha Rahman");
  const student = await signIn("student", ayesha.id);
  const proposal = await findAssessment(staff, "Project Proposal");
  const browser = await launchBrowser();

  try {
    // --- 1. Payment -------------------------------------------------------------------------------------------------
    console.log("1. Staff records a payment; the student sees it");
    const before = await api<MyFees>(student, "/api/me/fees");
    {
      const page = await browser.newPage();
      await page.setViewport(1280, 900);
      await open(page, staff, `/staff/students/${ayesha.id}`);
      await page.click("button", "Record payment");
      await page.settle(500);
      await page.click("#payment-amount");
      await page.type("5000");
      await page.click("#payment-method");
      await page.click('[role="option"]');
      await page.click("#payment-reference");
      await page.type(`E2E-${stamp}`);
      await page.click('[role="dialog"] button[type="submit"]');
      await page.settle(1500);
      page.close();
    }
    const after = await api<MyFees>(student, "/api/me/fees");
    check(
      Number(before.summary.balance) - Number(after.summary.balance) === 5000,
      `the balance fell by 5,000 (${before.summary.balance} -> ${after.summary.balance})`,
    );
    {
      const page = await browser.newPage();
      await page.setViewport(1280, 900);
      await open(page, student, "/student/fees");
      check(
        await waitForText(page, `E2E-${stamp}`),
        "the student's fees page lists the new payment",
      );
      page.close();
    }

    // --- 2. Upload --------------------------------------------------------------------------------------------------
    console.log("2. The student uploads a file; staff sees it");
    const file = path.join(
      mkdtempSync(path.join(tmpdir(), "sms-e2e-")),
      `e2e-proposal-${stamp}.pdf`,
    );
    writeFileSync(
      file,
      `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n% ${stamp}\n%%EOF\n`,
    );
    {
      const page = await browser.newPage();
      await page.setViewport(1280, 900);
      await open(page, student, `/student/assessments/${proposal.id}`);
      await page.setFiles("input[type=file]", [file]);
      await page.settle(400);
      await page.click("button", "Upload");
      check(await waitForText(page, "SHA-256"), "the student gets a receipt with a fingerprint");
      page.close();
    }
    {
      // Staff download the stored file through the access-checked link, whichever storage driver is configured.
      const mine = await api<MySubmission>(
        student,
        `/api/me/assessments/${proposal.id}/submission`,
      );
      const fileId = mine.assessment.submission?.currentFile.id;
      check(fileId !== undefined, "the student's submission has a current file");
      if (fileId) {
        const link = await api<{ url: string }>(staff, `/api/files/${fileId}/download`);
        const downloaded = await fetch(new URL(link.url, BASE_URL));
        const bytes = Buffer.from(await downloaded.arrayBuffer());
        check(
          downloaded.ok &&
            bytes.subarray(0, 5).toString("latin1") === "%PDF-" &&
            bytes.length === mine.assessment.submission?.currentFile.sizeBytes &&
            /^attachment;/.test(downloaded.headers.get("content-disposition") ?? ""),
          `staff download the uploaded PDF intact (${bytes.length} bytes)`,
        );
      }
    }
    {
      const page = await browser.newPage();
      await page.setViewport(1280, 900);
      await open(page, staff, `/staff/students/${ayesha.id}`);
      const text = await bodyText(page);
      check(
        text.includes(`e2e-proposal-${stamp}.pdf`),
        "the student record's Submissions section shows the file",
      );
      await open(page, staff, `/staff/assessments/${proposal.id}`);
      check(
        (await bodyText(page)).includes(`e2e-proposal-${stamp}.pdf`),
        "the assessment's Submissions tab shows the file",
      );
      page.close();
    }

    // --- 3. Mark and publish ----------------------------------------------------------------------------------------
    console.log("3. Staff enters a mark and publishes it; the student sees the result");
    {
      const page = await browser.newPage();
      await page.setViewport(1280, 900);
      await open(page, staff, `/staff/assessments/${proposal.id}`);
      await page.click('[role="tab"]', "Marksheet");
      await page.click(`input[aria-label="Mark for ${ayesha.fullName}"]`);
      await page.type("71.5");
      await page.key("Enter");
      await page.settle(1000);
      await page.click("button", "Publish");
      await page.settle(800);
      await page.click('[role="dialog"] button', "Publish 1");
      await page.settle(1500);
      page.close();
    }
    {
      const page = await browser.newPage();
      await page.setViewport(1280, 900);
      await open(page, student, "/student/results");
      const text = await bodyText(page);
      check(text.includes("71.5"), "the student's results page shows the published mark 71.5");
      check(text.includes("Merit") || text.includes("Distinction"), "with its classification");
      page.close();
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll hand-offs worked end to end.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
