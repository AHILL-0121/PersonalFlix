import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
    title: {
        default: "Personal Netflix",
        template: "%s | Personal Netflix",
    },
    description: "Your personal Google Drive streaming platform.",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <ClerkProvider>
            <html lang="en" className="dark">
                <body
                    className={`${inter.variable} font-sans bg-background text-text-primary antialiased`}
                >
                    {children}
                </body>
            </html>
        </ClerkProvider>
    );
}
