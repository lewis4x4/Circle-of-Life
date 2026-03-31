import type { Metadata, Viewport } from "next";
import { Inter, Outfit, Lora } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

const interSans = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const outfitDisplay = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const loraSerif = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Haven — Circle of Life",
  description:
    "Unified operations for assisted living, home health, and community-based care.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${interSans.variable} ${outfitDisplay.variable} ${loraSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div id="haven-app-root" className="flex min-h-full flex-col">
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-slate-900 focus:shadow-md focus:outline-none focus:ring-2 focus:ring-teal-600 dark:focus:bg-slate-900 dark:focus:text-slate-100"
            >
              Skip to main content
            </a>
            <div id="main-content">{children}</div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
