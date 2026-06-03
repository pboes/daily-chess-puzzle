import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/components/wallet/wallet-provider";
import { Header } from "@/components/header";
import { FundPot } from "@/components/fund-pot";

// Self-hosted at build time (no runtime font requests → no CSP changes).
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Daily Chess Duel — Circles Mini-App",
  description:
    "Solve the daily chess puzzle as fast as you can. Pay to enter with Circles, fastest solve wins the pot.",
  icons: {
    icon: "/chess-puzzle-avatar-512.png",
    apple: "/chess-puzzle-avatar-512.png",
  },
  openGraph: {
    title: "Daily Chess Duel",
    description: "Fastest solve wins the pot. A Circles mini-app.",
    images: ["/chess-puzzle-avatar-512.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#faf5f1",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={spaceGrotesk.variable}>
      <body>
        <WalletProvider>
          <div className="min-h-dvh px-4 pb-12">
            <Header />
            <main>{children}</main>
            <FundPot />
          </div>
        </WalletProvider>
      </body>
    </html>
  );
}
