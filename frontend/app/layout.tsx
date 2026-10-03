import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Sora } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ToastProvider } from "@/components/ui/Toasts";
import "./globals.css";
import "./screening.css";

const display = Sora({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display" });
const sans = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: "500", variable: "--font-mono" });

export const metadata: Metadata = {
    title: {
        default: "PersonalFlix",
        template: "%s · PersonalFlix",
    },
    description: "Your personal Google Drive streaming library.",
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: "#0b0b0b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <ClerkProvider>
            <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
                <body>
                    <ToastProvider>{children}</ToastProvider>
                </body>
            </html>
        </ClerkProvider>
    );
}
