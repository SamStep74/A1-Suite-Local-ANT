/**
 * DataTable — renders / sort / filter / page / select fan-out.
 *
 * The suite uses @testing-library/react + jsdom and exercises the
 * public surface: search input, header sort button, pagination
 * controls, row + select-all checkboxes, row click. It pins the
 * controlled-state shape and the `onStateChange` fan-out so that
 * SavedViews (which subscribes to that fan-out) doesn't drift.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { Trans, useLingui } from "@lingui/react/macro";

import { DataTable, makeSelectColumn } from "./DataTable";
import type { ColumnDef } from "@tanstack/react-table";

/* ────────── Lingui passthrough ────────── */

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
    <>{children ?? id ?? null}</>
  ),
  useLingui: () => ({
    t: (s: string | TemplateStringsArray) => (Array.isArray(s) ? s[0] : s),
    i18n: { _: (s: string) => s, locale: "hy" },
  }),
}));

// Re-import the mocked bindings so TypeScript thinks they exist.
void Trans;
void useLingui;

/* ────────── fixtures ────────── */

interface Row {
  id: string;
  name: string;
  amount: number;
}

const data: Row[] = [
  { id: "a", name: "Acme", amount: 100 },
  { id: "b", name: "Bravo", amount: 200 },
  { id: "c", name: "Charlie", amount: 300 },
  { id: "d", name: "Delta", amount: 400 },
];

const columns: ColumnDef<Row, unknown>[] = [
  makeSelectColumn<Row>(),
  { id: "name", header: "Name", accessorKey: "name", enableSorting: true },
  {
    id: "amount",
    header: "Amount",
    accessorKey: "amount",
    enableSorting: true,
    cell: ({ getValue }) => `₪${String(getValue())}`,
  },
];

const withQuery = (children: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("DataTable — basic render", () => {
  it("renders one row per data item with the given columns", () => {
    render(withQuery(<DataTable tableId="t1" columns={columns} data={data} />));
    expect(screen.getByTestId("data-table-row-a")).toBeInTheDocument();
    expect(screen.getByTestId("data-table-row-b")).toBeInTheDocument();
    expect(screen.getByTestId("data-table-row-c")).toBeInTheDocument();
    expect(screen.getByTestId("data-table-row-d")).toBeInTheDocument();
    expect(screen.getByText("₪100")).toBeInTheDocument();
    expect(screen.getByText("₪400")).toBeInTheDocument();
  });

  it("renders the search input and pagination summary", () => {
    render(withQuery(<DataTable tableId="t1" columns={columns} data={data} />));
    expect(screen.getByTestId("data-table-search")).toBeInTheDocument();
    expect(screen.getByTestId("data-table-page-summary").textContent).toMatch(/Showing 1.+4.+4/);
    expect(screen.getByTestId("data-table-prev")).toBeDisabled();
    expect(screen.getByTestId("data-table-next")).toBeDisabled();
  });

  it("renders the empty state when no rows match the filter", () => {
    render(
      withQuery(
        <DataTable
          tableId="t1"
          columns={columns}
          data={data}
          initialState={{ globalFilter: "zzz-no-match" }}
        />,
      ),
    );
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("renders a custom empty state when provided", () => {
    render(
      withQuery(
        <DataTable
          tableId="t1"
          columns={columns}
          data={data}
          initialState={{ globalFilter: "zzz-no-match" }}
          emptyState={<span>Custom empty</span>}
        />,
      ),
    );
    expect(screen.getByText("Custom empty")).toBeInTheDocument();
  });
});

describe("DataTable — sort", () => {
  it("clicking a sortable header toggles sort and the aria-sort attr", () => {
    render(withQuery(<DataTable tableId="t1" columns={columns} data={data} />));
    // TanStack v8's getAutoSortDir() returns 'asc' for string columns
    // and 'desc' for numeric columns. We click the string (name) column
    // so the test exercises the asc → desc → none toggle.
    const btn = screen.getByTestId("data-table-sort-name");
    const th = btn.closest("th");
    expect(th?.getAttribute("aria-sort")).toBe("none");
    fireEvent.click(btn);
    expect(th?.getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(btn);
    expect(th?.getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(btn);
    expect(th?.getAttribute("aria-sort")).toBe("none");
  });

  it("sort actually reorders the rendered rows", () => {
    render(withQuery(<DataTable tableId="t1" columns={columns} data={data} />));
    // Click numeric amount column — TanStack v8's getAutoSortDir picks
    // 'desc' first for numbers (largest-first is the common UX), so
    // the first click lands at desc: 400, 300, 200, 100.
    fireEvent.click(screen.getByTestId("data-table-sort-amount"));
    const descRows = screen.getAllByTestId(/^data-table-row-(?!select-)/);
    expect(descRows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "data-table-row-d",
      "data-table-row-c",
      "data-table-row-b",
      "data-table-row-a",
    ]);
    fireEvent.click(screen.getByTestId("data-table-sort-amount"));
    // Second click flips to asc: 100, 200, 300, 400.
    const ascRows = screen.getAllByTestId(/^data-table-row-(?!select-)/);
    expect(ascRows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "data-table-row-a",
      "data-table-row-b",
      "data-table-row-c",
      "data-table-row-d",
    ]);
  });
});

describe("DataTable — global filter", () => {
  it("filters the rendered rows by case-insensitive substring", () => {
    render(withQuery(<DataTable tableId="t1" columns={columns} data={data} />));
    const input = screen.getByTestId("data-table-search") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "bra" } });
    expect(screen.queryByTestId("data-table-row-a")).toBeNull();
    expect(screen.getByTestId("data-table-row-b")).toBeInTheDocument();
  });
});

describe("DataTable — pagination", () => {
  const many: Row[] = Array.from({ length: 30 }, (_, i) => ({
    id: `r${i}`,
    name: `Row ${i}`,
    amount: i,
  }));

  it("pages forward and back with the page controls", () => {
    render(withQuery(<DataTable tableId="t1" columns={columns} data={many} defaultPageSize={10} />));
    expect(screen.getByTestId("data-table-page-indicator").textContent).toMatch(/Page 1 of 3/);
    expect(screen.queryByTestId("data-table-row-r0")).toBeInTheDocument();
    expect(screen.queryByTestId("data-table-row-r20")).toBeNull();
    fireEvent.click(screen.getByTestId("data-table-next"));
    expect(screen.getByTestId("data-table-page-indicator").textContent).toMatch(/Page 2 of 3/);
    fireEvent.click(screen.getByTestId("data-table-next"));
    expect(screen.getByTestId("data-table-page-indicator").textContent).toMatch(/Page 3 of 3/);
    expect(screen.getByTestId("data-table-next")).toBeDisabled();
    fireEvent.click(screen.getByTestId("data-table-prev"));
    expect(screen.getByTestId("data-table-page-indicator").textContent).toMatch(/Page 2 of 3/);
  });
});

describe("DataTable — selection fan-out", () => {
  it("onSelectionChange fires when a row is selected", () => {
    const onSel = vi.fn();
    render(
      withQuery(
        <DataTable
          tableId="t1"
          columns={columns}
          data={data}
          onSelectionChange={onSel}
        />,
      ),
    );
    fireEvent.click(screen.getByTestId("data-table-row-select-a"));
    expect(onSel).toHaveBeenLastCalledWith(["a"]);
    fireEvent.click(screen.getByTestId("data-table-row-select-b"));
    expect(onSel).toHaveBeenLastCalledWith(["a", "b"]);
  });

  it("select-all toggles every row on the current page", () => {
    const onSel = vi.fn();
    render(
      withQuery(
        <DataTable tableId="t1" columns={columns} data={data} onSelectionChange={onSel} />,
      ),
    );
    const selectAll = screen.getByTestId("data-table-select-all") as HTMLInputElement;
    fireEvent.click(selectAll);
    expect(onSel).toHaveBeenLastCalledWith(["a", "b", "c", "d"]);
    fireEvent.click(selectAll);
    expect(onSel).toHaveBeenLastCalledWith([]);
  });
});

describe("DataTable — onRowClick", () => {
  it("row click fires the handler with the original record", () => {
    const onClick = vi.fn();
    render(
      withQuery(
        <DataTable
          tableId="t1"
          columns={columns}
          data={data}
          onRowClick={onClick}
        />,
      ),
    );
    fireEvent.click(screen.getByTestId("data-table-row-b"));
    expect(onClick).toHaveBeenCalledWith(data[1]);
  });

  it("checkbox cell click does not bubble to row click", () => {
    const onClick = vi.fn();
    const onSel = vi.fn();
    render(
      withQuery(
        <DataTable
          tableId="t1"
          columns={columns}
          data={data}
          onRowClick={onClick}
          onSelectionChange={onSel}
        />,
      ),
    );
    fireEvent.click(screen.getByTestId("data-table-row-select-b"));
    expect(onClick).not.toHaveBeenCalled();
    expect(onSel).toHaveBeenCalledWith(["b"]);
  });
});

describe("DataTable — renderToolbar", () => {
  it("calls renderToolbar and renders whatever it returns", () => {
    const renderToolbar = vi.fn(() => <button type="button">Save view</button>);
    render(
      withQuery(
        <DataTable
          tableId="t1"
          columns={columns}
          data={data}
          renderToolbar={renderToolbar}
        />,
      ),
    );
    expect(screen.getByRole("button", { name: "Save view" })).toBeInTheDocument();
    expect(renderToolbar).toHaveBeenCalledTimes(1);
    const allCalls = renderToolbar.mock.calls as unknown[][];
    const firstCall = allCalls[0];
    const arg = firstCall?.[0] as { selectedRowIds: string[] } | undefined;
    expect(arg?.selectedRowIds ?? []).toEqual([]);
  });
});

describe("DataTable — controlled state fan-out", () => {
  it("onStateChange fires with the full state when the search input changes", () => {
    const onState = vi.fn();
    render(
      withQuery(
        <DataTable
          tableId="t1"
          columns={columns}
          data={data}
          state={{}}
          onStateChange={onState}
        />,
      ),
    );
    const input = screen.getByTestId("data-table-search") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ac" } });
    expect(onState).toHaveBeenCalled();
    const last = onState.mock.calls.at(-1)?.[0] as { globalFilter: string };
    expect(last.globalFilter).toBe("ac");
  });
});

describe("DataTable — feature flags", () => {
  it("enablePagination=false hides the pagination controls", () => {
    render(
      withQuery(
        <DataTable
          tableId="t1"
          columns={columns}
          data={data}
          enablePagination={false}
        />,
      ),
    );
    expect(screen.queryByTestId("data-table-page-indicator")).toBeNull();
  });

  it("enableFiltering=false hides the search input", () => {
    render(
      withQuery(
        <DataTable
          tableId="t1"
          columns={columns}
          data={data}
          enableFiltering={false}
        />,
      ),
    );
    expect(screen.queryByTestId("data-table-search")).toBeNull();
  });

  it("enableSelection=false hides the select-all checkbox", () => {
    render(
      withQuery(
        <DataTable
          tableId="t1"
          columns={columns}
          data={data}
          enableSelection={false}
        />,
      ),
    );
    expect(screen.queryByTestId("data-table-select-all")).toBeNull();
  });
});

describe("DataTable — initialState (uncontrolled)", () => {
  it("respects initialState.sorting on first render", () => {
    render(
      withQuery(
        <DataTable
          tableId="t1"
          columns={columns}
          data={data}
          initialState={{ sorting: [{ id: "amount", desc: true }] }}
        />,
      ),
    );
    const rows = screen.getAllByTestId(/^data-table-row-(?!select-)/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "data-table-row-d",
      "data-table-row-c",
      "data-table-row-b",
      "data-table-row-a",
    ]);
    const th = screen.getByTestId("data-table-sort-amount").closest("th");
    expect(th?.getAttribute("aria-sort")).toBe("descending");
  });
});

describe("DataTable — getRowId", () => {
  it("uses getRowId to identify rows for selection and data-testid", () => {
    const onSel = vi.fn();
    render(
      withQuery(
        <DataTable
          tableId="t1"
          columns={columns}
          data={data}
          getRowId={(r) => r.id.toUpperCase()}
          onSelectionChange={onSel}
        />,
      ),
    );
    expect(screen.getByTestId("data-table-row-A")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("data-table-row-select-A"));
    expect(onSel).toHaveBeenLastCalledWith(["A"]);
  });
});

describe("DataTable — header column labels", () => {
  it("uses the column header definition for column titles", () => {
    render(withQuery(<DataTable tableId="t1" columns={columns} data={data} />));
    const headerRow = screen.getAllByRole("row")[0];
    if (!headerRow) throw new Error("missing header row");
    const headerCells = within(headerRow).getAllByRole("columnheader");
    // 0: select, 1: Name, 2: Amount
    expect(within(headerCells[1] as HTMLElement).getByText("Name")).toBeInTheDocument();
    expect(within(headerCells[2] as HTMLElement).getByText("Amount")).toBeInTheDocument();
  });
});
