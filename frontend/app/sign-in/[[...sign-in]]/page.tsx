import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Sign In",
    description: "Sign in to access your Personal Netflix library.",
};

export default function SignInPage() {
    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-8 px-4">
            {/* Logo / App name */}
            <div className="flex flex-col items-center gap-2 select-none">
                <span className="text-4xl font-bold tracking-tight text-text-primary">
                    Personal<span className="text-accent">Flix</span>
                </span>
                <p className="text-text-secondary text-sm">
                    Your private streaming library
                </p>
            </div>

            {/* Clerk sign-in widget */}
            <SignIn
                appearance={{
                    variables: {
                        colorPrimary: "#e0562d",
                        colorBackground: "#141414",
                        colorText: "#f0f0f0",
                        colorTextSecondary: "#a0a0a0",
                        colorInputBackground: "#1f1f1f",
                        colorInputText: "#f0f0f0",
                        borderRadius: "0.5rem",
                    },
                    elements: {
                        card: "shadow-2xl shadow-black/60 border border-surface-3",
                        headerTitle: "hidden",
                        headerSubtitle: "hidden",
                        socialButtonsBlockButton:
                            "bg-surface-2 border-surface-3 text-text-primary hover:bg-surface-3",
                        footerActionLink: "text-accent hover:text-accent-hover",
                        formButtonPrimary: "bg-accent hover:bg-accent-hover",
                    },
                }}
            />
        </div>
    );
}
