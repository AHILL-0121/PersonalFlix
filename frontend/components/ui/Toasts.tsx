"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Toast = { id: number; msg: string; ok: boolean };
const Ctx = createContext<(msg: string, ok?: boolean) => void>(() => {});

export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const push = useCallback((msg: string, ok = false) => {
        const id = Date.now() + Math.random();
        setToasts((t) => [...t, { id, msg, ok }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3300);
    }, []);
    return (
        <Ctx.Provider value={push}>
            {children}
            <div className="toasts" aria-live="polite">
                {toasts.map((t) => (
                    <div key={t.id} className={`toast${t.ok ? " ok" : ""}`}>
                        <i />
                        <span>{t.msg}</span>
                    </div>
                ))}
            </div>
        </Ctx.Provider>
    );
}
