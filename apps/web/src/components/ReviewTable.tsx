import { createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { formatDateLabel, type ActivityItem } from "@weekly/shared";
import { useMemo, useState } from "react";

const columnHelper = createColumnHelper<ActivityItem>();

interface ReviewTableProps {
  items: ActivityItem[];
  onToggleSelected: (item: ActivityItem, selected: boolean) => void;
  onOpen: (item: ActivityItem) => void;
}

export function ReviewTable({ items, onToggleSelected, onOpen }: ReviewTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "score", desc: true }]);

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: "Select",
        cell: (context) => (
          <input
            type="checkbox"
            checked={context.row.original.state.selected}
            onChange={(event) => onToggleSelected(context.row.original, event.target.checked)}
            onClick={(event) => event.stopPropagation()}
          />
        ),
      }),
      columnHelper.accessor((item) => (item.sourceMeta.source === "github" ? `${item.sourceMeta.organization}/${item.sourceMeta.repository}` : item.sourceMeta.forumName), {
        id: "container",
        header: "Repo / forum",
      }),
      columnHelper.accessor("title", {
        header: "Title",
      }),
      columnHelper.accessor((item) => item.score.total, {
        id: "score",
        header: "Total score",
        cell: (context) => context.getValue().toFixed(1),
      }),
      columnHelper.accessor((item) => (item.alreadyShared ? "Yes" : "No"), {
        id: "shared",
        header: "Already shared",
      }),
      columnHelper.accessor("createdAt", {
        header: "Created",
        cell: (context) => formatDateLabel(context.getValue()),
      }),
      columnHelper.accessor("completedAt", {
        header: "Completed",
        cell: (context) => formatDateLabel(context.getValue()),
      }),
      columnHelper.display({
        id: "link",
        header: "Original",
        cell: (context) => (
          <a href={context.row.original.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
            Open
          </a>
        ),
      }),
    ],
    [onToggleSelected],
  );

  const table = useReactTable({
    data: items,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="table-shell">
      <table>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} onClick={header.column.getToggleSortingHandler()}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} onClick={() => onOpen(row.original)}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

