import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Radio",
  description: "Live internet radio with now-playing info",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
