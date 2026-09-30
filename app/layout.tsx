import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./styles.css";

export const metadata: Metadata = {
  title: "Desert Journey",
  description:
    "An interactive story about finding yourself: travel in real time with a droid kid through the desert.",
};

// Lets the full-screen stage reach under the iPhone notch and home bar (see
// the safe-area padding in styles.css).
export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
