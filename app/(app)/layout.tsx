import { MicrosoftAuthProvider } from "@/components/providers/MicrosoftAuthProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { UserSettingsProvider } from "@/components/providers/UserSettingsProvider";

/**
 * Provider stack for the authenticated app surface (dashboard, apps, auth,
 * onboarding, redirect). Kept out of the root layout so marketing pages
 * don't ship MSAL, react-query, and the settings machinery to anonymous
 * visitors.
 */
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <QueryProvider>
      <MicrosoftAuthProvider>
        <UserSettingsProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </UserSettingsProvider>
      </MicrosoftAuthProvider>
    </QueryProvider>
  );
}
