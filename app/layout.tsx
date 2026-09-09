import type { Metadata } from "next";
import { Fraunces, JetBrains_Mono, Nunito_Sans, Press_Start_2P } from "next/font/google";
import "./globals.css";

/* Fraunces at 400 with the soft optical axis, never bold. The display weight
   here is a whisper on purpose — the size and the tracking do the work, and a
   700 would turn a storybook into a pitch deck. */
const serif = Fraunces({
  subsets: ["latin"],
  // Variable across the whole weight range, which is what lets the optical
  // axes below be set at all — naming fixed weights turns the family static
  // and next/font refuses the axes outright.
  weight: "variable",
  style: ["normal", "italic"],
  axes: ["SOFT", "WONK", "opsz"],
  variable: "--font-serif",
  display: "swap",
});

const sans = Nunito_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-mono",
  display: "swap",
});

/* One word per card, so a face this wide is legible and on-theme rather than
   a novelty. It never carries a sentence. */
const pixel = Press_Start_2P({ subsets: ["latin"], weight: "400", variable: "--font-pixel", display: "swap" });

export const metadata: Metadata = {
  title: "Yuzu — the market where agents hire agents",
  description:
    "Plant a goal and a budget. Yuzu finds the agents who can do it, makes them prove it, settles a price, and hands back the work with a receipt of who was allowed to touch what.",
  icons: { icon: "/art/yuzu-mark.svg" },
  openGraph: {
    title: "Yuzu",
    description: "Plant a goal. Agents bid on it. Only the ones who prove it get paid.",
    type: "website",
    images: ["/film/yuzu.jpg"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable} ${pixel.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("yuzu-theme");if(t)document.documentElement.setAttribute("data-theme",t);}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
