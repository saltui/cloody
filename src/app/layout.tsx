import type { Metadata } from "next";
import { ThemeProvider } from "@/lib/theme";
import { UploadProvider } from "@/lib/upload-context";
import { DownloadProvider } from "@/lib/download-context";
import { SignedUrlProvider } from "@/lib/signed-url-context";
import { UserProvider } from "@/lib/user-context";
import { TdsProvider } from "@/lib/tds-provider";
import { DataCacheProvider } from "@/lib/data-cache";
import UploadPanel from "@/components/UploadPanel";
import DownloadPanel from "@/components/DownloadPanel";
import NavigationBlocker from "@/components/NavigationBlocker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cloody",
  description: "Jaden's Private Cloud",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <TdsProvider>
            <UserProvider>
              <DataCacheProvider>
                <SignedUrlProvider>
                  <UploadProvider>
                    <DownloadProvider>
                      <NavigationBlocker />
                      {children}
                      <UploadPanel />
                      <DownloadPanel />
                    </DownloadProvider>
                  </UploadProvider>
                </SignedUrlProvider>
              </DataCacheProvider>
            </UserProvider>
          </TdsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
