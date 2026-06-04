import type { Metadata } from "next";
import "./globals.css";
import { PersistenceBootstrap } from "./components/PersistenceBootstrap";

export const metadata: Metadata = {
  // Title is managed client-side (app/page.tsx) to reflect the current station
  // and song. We intentionally don't set a metadata title here: a static,
  // metadata-managed <title> gets re-asserted by React on re-render and fights
  // the client-side document.title updates.
  description: "Live internet radio with now-playing info",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PersistenceBootstrap />
        {children}
      </body>
    </html>
  );
}
