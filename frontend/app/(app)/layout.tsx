import AppShell from "@/app/components/AppShell";
import { AskProvider } from "@/app/components/AskStore";

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <AskProvider>{children}</AskProvider>
    </AppShell>
  );
}
