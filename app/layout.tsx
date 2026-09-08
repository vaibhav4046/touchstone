import type { Metadata } from "next";
import { Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const serif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const mono = JetBrains_Mono({
  weight: ["400", "600"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Touchstone — the assay office for agent services",
  description:
    "Agents are about to start buying from agents. Touchstone reads a vendor's own listing and returns a signed verdict on which of its claims are checkable, which are not, and which are attempts to instruct the agent reading them.",
  openGraph: {
    title: "Touchstone",
    description: "Don't trust the listing. Assay the agent.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${mono.variable}`}>
      <head>
        {/* Theme is resolved before first paint so a light-mode reader never
            gets a black flash, and never the reverse either. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("touchstone-theme");if(t)document.documentElement.setAttribute("data-theme",t);}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
