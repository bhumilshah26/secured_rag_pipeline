// Shared connector-kind metadata (kept out of page.tsx, which may only export a default).
import { Icon, type IconName } from "@/app/components/icons";

export const KIND_LABEL: Record<string, string> = {
  gdrive: "Google Drive", onedrive: "OneDrive", sharepoint: "SharePoint",
  confluence: "Confluence", slack: "Slack",
};

export const KIND_ICON: Record<string, IconName> = {
  gdrive: "gdrive", onedrive: "onedrive", sharepoint: "sharepoint",
  confluence: "confluence", slack: "slack",
};

export function KindIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  return <Icon name={KIND_ICON[kind] ?? "connectors"} size={size} />;
}
