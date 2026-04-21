/** Download CSV in the browser (matches HTML dashboard pattern). */
export function downloadCsv(rows: (string | number)[][], filename: string) {
  const csvContent = rows
    .map((row) =>
      row.map((field) => `"${String(field).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.visibility = "hidden";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
