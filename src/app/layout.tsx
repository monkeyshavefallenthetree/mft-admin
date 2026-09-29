import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MFT Admin — Command Terminal",
  description: "MFT operations command terminal (submissions, workers, tasks, projects, HR).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

