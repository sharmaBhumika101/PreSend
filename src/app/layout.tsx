import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PreSend — Pre-send fraud triage",
  description:
    "Pre-send fraud triage console: score, explain, and action pending outbound payments before they leave the platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
