import { Loader2 } from "lucide-react";

export default function GlobalLoading() {
    return (
        <div className="fixed inset-0 min-h-screen bg-background flex flex-col items-center justify-center z-50">
            <div className="flex flex-col items-center gap-4 animate-in fade-in duration-500">
                <div className="relative">
                    {/* Outer glowing ring */}
                    <div className="absolute inset-0 rounded-full blur-md bg-accent/30 animate-pulse" />

                    {/* Inner spinning loader */}
                    <Loader2 className="w-12 h-12 text-accent animate-spin relative z-10" />
                </div>

                <p className="text-text-muted text-sm tracking-widest font-medium uppercase mt-2">
                    Loading
                </p>
            </div>
        </div>
    );
}
