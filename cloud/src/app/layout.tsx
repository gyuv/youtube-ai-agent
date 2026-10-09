import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumen Cloud",
  description: "Zero-cost, fully cloud-hosted YouTube automation studio",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen font-sans">
        {children}
        <Toaster theme="dark" position="bottom-right" richColors closeButton toastOptions={{ className: "!rounded-xl !border-white/10 !bg-[oklch(0.19_0.022_285)]/90 !backdrop-blur-xl" }} />
      </body>
    </html>
  );
}
