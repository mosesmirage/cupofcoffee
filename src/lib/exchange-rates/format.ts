export function formatFetchTime(timestamp: string | null | undefined): string {
  if (typeof timestamp !== "string" || timestamp.trim() === "") {
    return "Fetch time unavailable";
  }

  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "Fetch time unavailable";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
