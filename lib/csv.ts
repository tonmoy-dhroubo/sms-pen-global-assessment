// CSV for the exports (api.md "Exports"): UTF-8 with a byte order mark, so Excel shows Bengali text and the taka sign
// instead of mojibake; RFC 4180 quoting with CRLF line endings; and a guard against spreadsheet formula injection.
// Pure functions, no server imports, so they can be unit-tested and the rules read in one place.

/** The byte order mark Excel needs to treat the file as UTF-8. */
export const CSV_BOM = "﻿";

export type CsvCell = string | number | null | undefined;

/**
 * A cell that a spreadsheet would run as a formula starts with `=`, `+`, `-` or `@` (or a tab or carriage return,
 * which some programs skip before looking). Names, reasons and file names are typed by people, so such text gets an
 * apostrophe in front; the spreadsheet then shows the text as typed. Numbers are not text and are never touched.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One field, ready to sit between commas. */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  // Quote when the field holds a comma, a quote or a line break; a quote inside is doubled.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A whole file: the BOM, a header row and the rows, each line ending in CRLF. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}
