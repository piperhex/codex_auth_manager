export function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}
