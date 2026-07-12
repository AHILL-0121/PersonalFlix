/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                background: "#0b0b0b",
                surface: "#141414",
                "surface-2": "#1f1f1f",
                "surface-3": "#2a2a2a",
                accent: "#e0562d",
                "accent-hover": "#c94c27",
                "text-primary": "#f0f0f0",
                "text-secondary": "#a0a0a0",
                "text-muted": "#5a5a5a",
            },
            fontFamily: {
                sans: ["Inter", "system-ui", "sans-serif"],
            },
            borderRadius: {
                poster: "8px",
            },
            transitionDuration: {
                DEFAULT: "150ms",
                medium: "200ms",
            },
            aspectRatio: {
                poster: "2 / 3",
            },
            keyframes: {
                "fade-in": {
                    from: { opacity: "0", transform: "translateY(6px)" },
                    to: { opacity: "1", transform: "translateY(0)" },
                },
                "fade-out": {
                    from: { opacity: "1" },
                    to: { opacity: "0" },
                },
                countdown: {
                    from: { strokeDashoffset: "0" },
                    to: { strokeDashoffset: "100" },
                },
            },
            animation: {
                "fade-in": "fade-in 0.2s ease-out forwards",
                "fade-out": "fade-out 0.15s ease-in forwards",
            },
        },
    },
    plugins: [],
};
