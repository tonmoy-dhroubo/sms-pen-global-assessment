import { z } from "zod";

// Request schemas for the upload flow (api.md "Submissions and files"), shared by the upload panel and the Route
// Handlers. The browser pre-checks a file with `checkUploadFile` so most mistakes are caught before anything is sent;
// the server runs the same checks again (and then looks inside the file), because the server is the authority.

/** The only file types a submission may have, and the MIME type each one is uploaded with. */
export const UPLOAD_MIME_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;
export type UploadExtension = keyof typeof UPLOAD_MIME_TYPES;

export const FILE_NAME_MAX_LENGTH = 255;

/** Extensions of Word files that can carry macros; they get their own, clearer message. */
const MACRO_EXTENSIONS = new Set(["docm", "dotm"]);

const WRONG_TYPE = "Only PDF (.pdf) and Word (.docx) files can be submitted.";
const MACRO_FILE =
  "Macro-enabled Word files are not accepted. Save the document as a plain .docx (without macros) and upload that.";

/** The lower-case extension after the last dot (`"Essay.PDF"` is `"pdf"`), or `null` when there is none. */
export function extensionOf(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 1 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}

/** `pdf` or `docx` when the name ends in one of them, else `null`. */
export function uploadExtensionOf(fileName: string): UploadExtension | null {
  const extension = extensionOf(fileName);
  return extension === "pdf" || extension === "docx" ? extension : null;
}

/**
 * A file name as stored: any folder part a browser or script might have sent is dropped, text is Unicode-normalised,
 * and surrounding space is trimmed. The name is only ever metadata (the storage key is chosen by the server).
 */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  return base.normalize("NFC").trim();
}

/** Why a file name cannot be submitted, as a message for the student; `null` when it can. */
export function fileNameProblem(fileName: string): string | null {
  if (fileName === "") return "Choose a file.";
  if ([...fileName].length > FILE_NAME_MAX_LENGTH) {
    return `Shorten the file name to ${FILE_NAME_MAX_LENGTH} characters or fewer.`;
  }
  if (/[\x00-\x1f\x7f]/.test(fileName))
    return "The file name contains characters that are not allowed.";
  const extension = extensionOf(fileName);
  if (extension !== null && MACRO_EXTENSIONS.has(extension)) return MACRO_FILE;
  if (uploadExtensionOf(fileName) === null) return WRONG_TYPE;
  return null;
}

/** A readable size limit for messages: `20 MB`. */
export function formatLimit(maxBytes: number): string {
  return `${Math.round(maxBytes / (1024 * 1024))} MB`;
}

/**
 * Everything the browser can know about a chosen file before uploading it: name and type, emptiness and size.
 * Returns the first problem in plain words, or `null` when the file looks fine. `maxBytes` is the server's limit.
 */
export function checkUploadFile(
  file: { name: string; size: number },
  maxBytes: number,
): string | null {
  const nameProblem = fileNameProblem(cleanFileName(file.name));
  if (nameProblem) return nameProblem;
  if (file.size <= 0) return "This file is empty. Choose a file that has content.";
  if (file.size > maxBytes) {
    return `This file is too large. The limit is ${formatLimit(maxBytes)}.`;
  }
  return null;
}

// --- Request bodies ---------------------------------------------------------------------------------------------

export const uploadUrlSchema = z
  .object({
    fileName: z
      .string({ required_error: "Choose a file." })
      .transform(cleanFileName)
      .superRefine((name, ctx) => {
        const problem = fileNameProblem(name);
        if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
      }),
    contentType: z.string({ required_error: "The file type is missing." }),
    sizeBytes: z
      .number({
        required_error: "The file size is missing.",
        invalid_type_error: "The file size must be a number of bytes.",
      })
      .int("The file size must be a whole number of bytes.")
      .positive("This file is empty. Choose a file that has content."),
  })
  .superRefine((value, ctx) => {
    const extension = uploadExtensionOf(value.fileName);
    if (extension === null) return; // already reported on fileName
    if (value.contentType.trim().toLowerCase() !== UPLOAD_MIME_TYPES[extension]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contentType"],
        message: `A .${extension} file must be sent as ${UPLOAD_MIME_TYPES[extension]}.`,
      });
    }
  });
export type UploadUrlInput = z.infer<typeof uploadUrlSchema>;

export const confirmUploadSchema = z.object({
  pendingUploadId: z
    .string({ required_error: "pendingUploadId is required." })
    .uuid("pendingUploadId must be an id returned by the upload-url step."),
});
export type ConfirmUploadInput = z.infer<typeof confirmUploadSchema>;
