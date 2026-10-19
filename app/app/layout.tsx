import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CERMS",
  description: "Campus Event and Resource Management System"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
