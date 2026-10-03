import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Sign In",
    description: "Sign in to your PersonalFlix library.",
};

export default function SignInPage() {
    return (
        <>
            <div className="ambient" aria-hidden="true" />
            <main className="signin">
                <div className="logo" aria-label="PersonalFlix">Personal<i>Flix</i></div>
                <p>Your private screening room</p>
                <SignIn
                    appearance={{
                        variables: {
                            colorPrimary: "#e50914",
                            colorBackground: "#181818",
                            colorText: "#ffffff",
                            colorTextSecondary: "#b3b3b3",
                            colorInputBackground: "#232323",
                            colorInputText: "#ffffff",
                            borderRadius: "12px",
                            fontFamily: "var(--font-sans), Inter, system-ui, sans-serif",
                        },
                        elements: {
                            card: { boxShadow: "0 30px 60px -20px rgba(0,0,0,.8)", border: "1px solid rgba(255,255,255,.14)" },
                            headerTitle: { display: "none" },
                            headerSubtitle: { display: "none" },
                            formButtonPrimary: { color: "#ffffff", fontWeight: 600 },
                        },
                    }}
                />
            </main>
        </>
    );
}
