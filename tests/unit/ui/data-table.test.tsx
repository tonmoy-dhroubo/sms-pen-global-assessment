// @vitest-environment jsdom
import "@/tests/support/dom";
import type { ColumnDef } from "@tanstack/react-table";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable } from "@/components/data-table/data-table";

const push = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/staff/students",
  useSearchParams: () => new URLSearchParams(search),
}));

interface Row {
  id: string;
  name: string;
  number: string;
}

const ROWS: Row[] = [
  { id: "1", name: "Anika Tabassum", number: "SMS-2026-0012" },
  { id: "2", name: "Arif Hossain", number: "SMS-2026-0001" },
];

const COLUMNS: ColumnDef<Row, unknown>[] = [
  { id: "fullName", header: "Name", accessorKey: "name", enableSorting: true },
  { id: "studentNumber", header: "Student ID", accessorKey: "number", enableSorting: true },
  { id: "notes", header: "Notes", cell: () => "n/a" },
];

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(
    <DataTable
      caption="Students"
      columns={COLUMNS}
      data={ROWS}
      total={60}
      page={2}
      pageSize={25}
      getRowId={(row) => row.id}
      {...props}
    />,
  );
}

beforeEach(() => {
  push.mockClear();
  search = "";
});

describe("DataTable", () => {
  it("renders the rows with an accessible caption and headers", () => {
    renderTable();
    expect(screen.getByRole("table", { name: "Students" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.getByText("Anika Tabassum")).toBeTruthy();
    expect(screen.getByText("SMS-2026-0001")).toBeTruthy();
  });

  it("shows the range and page position", () => {
    renderTable();
    expect(screen.getByText("Showing 26–50 of 60")).toBeTruthy();
    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
  });

  it("clips the last page's range to the total", () => {
    renderTable({ page: 3 });
    expect(screen.getByText("Showing 51–60 of 60")).toBeTruthy();
  });

  it("goes to the next and previous page through the URL, keeping other params", async () => {
    search = "q=anika&status=ENROLLED&page=2";
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(push).toHaveBeenLastCalledWith("/staff/students?q=anika&status=ENROLLED&page=3", {
      scroll: false,
    });

    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(push).toHaveBeenLastCalledWith("/staff/students?q=anika&status=ENROLLED", {
      scroll: false,
    });
  });

  it("disables Previous on the first page and Next on the last", () => {
    const { unmount } = renderTable({ page: 1 });
    expect(screen.getByRole("button", { name: "Previous page" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Next page" }).hasAttribute("disabled")).toBe(false);
    unmount();

    renderTable({ page: 3 });
    expect(screen.getByRole("button", { name: "Next page" }).hasAttribute("disabled")).toBe(true);
  });

  it("sorts ascending, then descending, then clears, resetting to page 1", async () => {
    const user = userEvent.setup();
    const { rerender } = renderTable({ sort: null });

    await user.click(within(screen.getAllByRole("columnheader")[0]!).getByRole("button"));
    expect(push).toHaveBeenLastCalledWith("/staff/students?sort=fullName", { scroll: false });

    rerender(
      <DataTable
        caption="Students"
        columns={COLUMNS}
        data={ROWS}
        total={60}
        page={2}
        pageSize={25}
        sort="fullName"
      />,
    );
    expect(screen.getAllByRole("columnheader")[0]!.getAttribute("aria-sort")).toBe("ascending");
    await user.click(within(screen.getAllByRole("columnheader")[0]!).getByRole("button"));
    expect(push).toHaveBeenLastCalledWith("/staff/students?sort=-fullName", { scroll: false });

    rerender(
      <DataTable
        caption="Students"
        columns={COLUMNS}
        data={ROWS}
        total={60}
        page={2}
        pageSize={25}
        sort="-fullName"
      />,
    );
    expect(screen.getAllByRole("columnheader")[0]!.getAttribute("aria-sort")).toBe("descending");
    await user.click(within(screen.getAllByRole("columnheader")[0]!).getByRole("button"));
    expect(push).toHaveBeenLastCalledWith("/staff/students", { scroll: false });
  });

  it("resets to page 1 when sorting while on a later page", async () => {
    search = "page=2";
    const user = userEvent.setup();
    renderTable();
    await user.click(within(screen.getAllByRole("columnheader")[1]!).getByRole("button"));
    expect(push).toHaveBeenLastCalledWith("/staff/students?sort=studentNumber", { scroll: false });
  });

  it("only offers sorting on columns that opt in", () => {
    renderTable();
    expect(within(screen.getAllByRole("columnheader")[2]!).queryByRole("button")).toBeNull();
  });

  it("makes a column sortable when it only has an id and a custom cell (no accessor)", async () => {
    const user = userEvent.setup();
    renderTable({
      columns: [{ id: "overdueAmount", header: "Overdue", enableSorting: true, cell: () => "x" }],
    });
    await user.click(screen.getByRole("button", { name: /Overdue/ }));
    expect(push).toHaveBeenCalledWith("/staff/students?sort=overdueAmount", { scroll: false });
  });

  it("changes the page size through the URL", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole("combobox", { name: "Rows per page" }));
    await user.click(await screen.findByRole("option", { name: "50" }));
    expect(push).toHaveBeenLastCalledWith("/staff/students?pageSize=50", { scroll: false });
  });

  it("shows the empty state instead of a table when there are no rows", () => {
    renderTable({
      data: [],
      total: 0,
      page: 1,
      emptyState: <p>No students match these filters.</p>,
    });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("No students match these filters.")).toBeTruthy();
  });

  it("has a default empty state", () => {
    renderTable({ data: [], total: 0, page: 1 });
    expect(screen.getByText("Nothing to show")).toBeTruthy();
  });

  it("offers a way back when the page number is past the end", async () => {
    search = "page=9";
    const user = userEvent.setup();
    renderTable({ data: [], total: 60, page: 9 });
    expect(screen.getByText("No rows on this page")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Go to the first page" }));
    expect(push).toHaveBeenLastCalledWith("/staff/students", { scroll: false });
  });
});
