import type { Metadata } from "next";
import { Inter, Merriweather } from "next/font/google";
import "./globals.css";

const merriweather = Merriweather({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});

const inter = Inter({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cosmo - Your smart best friend",
  description: "The AI companion that actually knows you—and that you actually enjoy talking to.",
  icons: {
    icon: "/favicon.svg",
    apple: "/favicon.svg",
  },
  openGraph: {
    title: "Cosmo - Your smart best friend",
    description: "The AI companion that actually knows you—and that you actually enjoy talking to.",
    url: "https://saturn.cosmo.it.com",
    siteName: "Cosmo",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Cosmo - Your smart best friend",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Cosmo - Your smart best friend",
    description: "The AI companion that actually knows you—and that you actually enjoy talking to.",
    images: ["/og-image.png"],
  },
  metadataBase: new URL("https://saturn.cosmo.it.com"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${merriweather.variable} ${inter.variable} font-body antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
