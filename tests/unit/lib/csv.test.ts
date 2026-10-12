import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, toCsv } from "@/lib/csv";

// The CSV rules of the exports (api.md "Exports"): RFC 4180 quoting, a byte order mark for Excel, CRLF lines, and a
// guard against spreadsheet formula injection.

describe("csvCell: quoting (RFC 4180)", () => {
  it("leaves plain text alone", () => {
    expect(csvCell("Ayesha Rahman")).toBe("Ayesha Rahman");
    expect(csvCell("SMS-2026-0001")).toBe("SMS-2026-0001");
  });

  it("quotes a field with a comma, and doubles the quotes inside one", () => {
    expect(csvCell("Rahman, Ayesha")).toBe('"Rahman, Ayesha"');
    expect(csvCell('She said "hi"')).toBe('"She said ""hi"""');
    expect(csvCell('"')).toBe('""""');
  });

  it("quotes a field with a line break (CR, LF or both)", () => {
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
    expect(csvCell("a\rb")).toBe('"a\rb"');
  });

  it("writes nothing for null and undefined, and numbers as they are", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(-12)).toBe("-12");
    expect(csvCell(40000.5)).toBe("40000.5");
  });

  it("keeps Bengali text and the taka sign as they are", () => {
    expect(csvCell("আয়েশা রহমান")).toBe("আয়েশা রহমান");
    expect(csvCell("৳1,25,000.00")).toBe('"৳1,25,000.00"');
  });
});

describe("csvCell: formula-injection guard", () => {
  it.each(["=SUM(A1:A9)", "+1+1", "-2+3", "@SUM(1)", "\tcmd", "\rcmd"])(
    "puts an apostrophe in front of %j",
    (text) => {
      expect(csvCell(text).replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );

  it("guards before quoting, so a guarded cell with a comma is still one field", () => {
    expect(csvCell('=HYPERLINK("http://evil.example","x")')).toBe(
      '"\'=HYPERLINK(""http://evil.example"",""x"")"',
    );
    expect(csvCell("=1,2")).toBe('"\'=1,2"');
  });

  it("does not touch text that only contains those characters further in", () => {
    expect(csvCell("Essay = good")).toBe("Essay = good");
    expect(csvCell("a-b")).toBe("a-b");
    expect(csvCell("name@example.com")).toBe("name@example.com");
    expect(csvCell("SMS-2026-0001")).toBe("SMS-2026-0001");
  });

  it("does not touch real numbers, even negative ones", () => {
    expect(csvCell(-5)).toBe("-5");
  });
});

describe("toCsv", () => {
  it("starts with a byte order mark and ends every line, the last included, with CRLF", () => {
    const csv = toCsv(["Name", "Mark"], [["Ayesha", "62.5"]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(CSV_BOM.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe(`${CSV_BOM}Name,Mark\r\nAyesha,62.5\r\n`);
  });

  it("writes only the header for no rows", () => {
    expect(toCsv(["A", "B"], [])).toBe(`${CSV_BOM}A,B\r\n`);
  });

  it("encodes as UTF-8 with the BOM bytes EF BB BF first", () => {
    const bytes = new TextEncoder().encode(toCsv(["Name"], [["আয়েশা"]]));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("quotes and guards the header as well as the rows", () => {
    expect(toCsv(["=bad", "a,b"], [])).toBe(`${CSV_BOM}'=bad,"a,b"\r\n`);
  });

  it("keeps empty cells so the columns stay aligned", () => {
    expect(toCsv(["A", "B", "C"], [["x", null, undefined]])).toBe(`${CSV_BOM}A,B,C\r\nx,,\r\n`);
  });
});
