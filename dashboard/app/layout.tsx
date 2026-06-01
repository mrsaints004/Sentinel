import type { Metadata } from "next";
import "./globals.css";
import { WalletProviderWrapper } from "../components/WalletProvider";

export const metadata: Metadata = {
  title: "Sentinel — AI Treasury on Mantle",
  description: "Deposit USDC. Set your risk level. Sentinel's AI earns yield on Mantle — fully autonomous, fully on-chain.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-s-bg text-s-text antialiased">
        <WalletProviderWrapper>
          {children}
        </WalletProviderWrapper>
      </body>
    </html>
  );
}
