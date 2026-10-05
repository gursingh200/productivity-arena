import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const nohemi = localFont({
  src: "../fonts/Nohemi-VF.woff2",
  weight: "100 900",
  variable: "--font-nohemi",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Arena",
  description: "How much you work, and how much your agents work for you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={nohemi.variable}>
      <body>{children}</body>
    </html>
  );
}
