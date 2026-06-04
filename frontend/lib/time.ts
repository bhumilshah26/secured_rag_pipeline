export type TimeRange = "all" | "24h" | "7d" | "30d";

export const TIME_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

const SPANS: Record<Exclude<TimeRange, "all">, number> = {
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

export function withinRange(iso: string | null | undefined, range: TimeRange): boolean {
  if (range === "all" || !iso) return true;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t <= SPANS[range];
}
