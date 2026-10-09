/** Form values use a dot decimal when populated from JSON; also accept Brazilian input. */
export function parseNumber(value: string): number | null {
  const text = value.trim().replace(/\s/g, "");
  if (!text) return null;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}
export function csvCell(value: unknown): string {
  let text = typeof value === "number" ? String(value).replace(".", ",") : String(value ?? "");
  if (typeof value !== "number" && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
