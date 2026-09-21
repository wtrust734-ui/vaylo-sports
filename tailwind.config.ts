import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "Inter", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        energy: {
          DEFAULT: "hsl(var(--energy))",
          foreground: "hsl(var(--energy-foreground))",
        },
        electric: {
          DEFAULT: "hsl(var(--electric))",
          glow: "hsl(var(--electric-glow))",
          purple: "hsl(var(--electric-purple))",
          "purple-glow": "hsl(var(--electric-purple-glow))",
        },
        navy: {
          DEFAULT: "hsl(var(--navy))",
          deep: "hsl(var(--navy-deep))",
        },
        warning: "hsl(var(--warning))",
        info: "hsl(var(--info))",
        success: "hsl(var(--success))",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      // Elevation ramp for the dark foundation. Use these instead of ad-hoc
      // shadow-[...] strings so depth is consistent across screens.
      boxShadow: {
        "elev-1": "0 1px 2px hsl(222 50% 3% / 0.5)",
        "elev-2": "0 8px 24px hsl(222 50% 3% / 0.45)",
        "elev-3": "0 18px 48px hsl(222 50% 3% / 0.55)",
        "glow-electric": "0 0 22px hsla(217, 100%, 58%, 0.4)",
        "glow-electric-soft": "0 0 22px hsla(217, 100%, 58%, 0.35)",
        "glow-energy": "0 0 30px hsl(38 92% 50% / 0.4)",
        "glow-energy-strong": "0 0 60px hsl(38 92% 50% / 0.5)",
        "glow-primary": "0 0 22px hsla(270, 80%, 60%, 0.35)",
      },
      // Layout tokens used by the app shell (the mobile bottom bar and the
      // device safe areas a Capacitor build will rely on).
      spacing: {
        "safe-b": "max(1rem, env(safe-area-inset-bottom))",
        "safe-t": "env(safe-area-inset-top)",
        tab: "4.5rem",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "1" },
        },
        "slide-up": {
          from: { transform: "translateY(10px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "electric-pulse": {
          "0%, 100%": { boxShadow: "0 0 20px hsla(217, 100%, 58%, 0.2)" },
          "50%": { boxShadow: "0 0 40px hsla(217, 100%, 58%, 0.5)" },
        },
        "shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "shimmer-sweep": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        "tap-bounce": {
          "0%": { transform: "scale(1)" },
          "50%": { transform: "scale(0.97)" },
          "100%": { transform: "scale(1)" },
        },
        "float": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-6px)" },
        },
        "glow-border": {
          "0%, 100%": { borderColor: "hsla(217, 100%, 58%, 0.3)" },
          "50%": { borderColor: "hsla(217, 100%, 58%, 0.7)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "slide-up": "slide-up 0.4s ease-out",
        "electric-pulse": "electric-pulse 2s ease-in-out infinite",
        "shimmer": "shimmer 2s linear infinite",
        "shimmer-sweep": "shimmer-sweep 1.6s linear infinite",
        "tap-bounce": "tap-bounce 0.18s ease-out",
        "float": "float 3s ease-in-out infinite",
        "glow-border": "glow-border 2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
