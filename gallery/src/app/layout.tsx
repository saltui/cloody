import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/lib/theme";
import { UploadProvider } from "@/lib/upload-context";
import { DownloadProvider } from "@/lib/download-context";
import { SignedUrlProvider } from "@/lib/signed-url-context";
import { UserProvider } from "@/lib/user-context";
import UploadPanel from "@/components/UploadPanel";
import DownloadPanel from "@/components/DownloadPanel";
import NavigationBlocker from "@/components/NavigationBlocker";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cloody",
  description: "Your Secure Private Cloud",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>
          <UserProvider>
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
          </UserProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
