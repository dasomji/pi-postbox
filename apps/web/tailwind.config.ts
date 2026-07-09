import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{svelte,ts}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Iowan Old Style", "Palatino Linotype", "Palatino", "Georgia", "Times New Roman", "serif"]
      },
      colors: {
        postbox: {
          canvas: "rgb(var(--color-postbox-canvas) / <alpha-value>)",
          surface: "rgb(var(--color-postbox-surface) / <alpha-value>)",
          elevated: "rgb(var(--color-postbox-elevated) / <alpha-value>)",
          muted: "rgb(var(--color-postbox-muted) / <alpha-value>)",
          border: "rgb(var(--color-postbox-border) / <alpha-value>)",
          "border-strong": "rgb(var(--color-postbox-border-strong) / <alpha-value>)",
          text: "rgb(var(--color-postbox-text) / <alpha-value>)",
          subtle: "rgb(var(--color-postbox-subtle) / <alpha-value>)"
        },
        attention: {
          DEFAULT: "rgb(var(--color-attention) / <alpha-value>)",
          foreground: "rgb(var(--color-attention-foreground) / <alpha-value>)",
          contrast: "rgb(var(--color-attention-contrast) / <alpha-value>)",
          border: "rgb(var(--color-attention-border) / <alpha-value>)"
        },
        history: {
          DEFAULT: "rgb(var(--color-history) / <alpha-value>)",
          foreground: "rgb(var(--color-history-foreground) / <alpha-value>)",
          border: "rgb(var(--color-history-border) / <alpha-value>)"
        },
        success: {
          DEFAULT: "rgb(var(--color-success) / <alpha-value>)",
          foreground: "rgb(var(--color-success-foreground) / <alpha-value>)"
        },
        warning: {
          DEFAULT: "rgb(var(--color-warning) / <alpha-value>)",
          foreground: "rgb(var(--color-warning-foreground) / <alpha-value>)"
        },
        danger: {
          DEFAULT: "rgb(var(--color-danger) / <alpha-value>)",
          foreground: "rgb(var(--color-danger-foreground) / <alpha-value>)"
        }
      },
      boxShadow: {
        "postbox-panel": "0 14px 30px -12px rgb(var(--color-postbox-shadow) / 0.35)",
        "postbox-section": "0 10px 20px -14px rgb(var(--color-postbox-shadow) / 0.25)",
        "postbox-paper": "0 1px 2px rgb(var(--color-postbox-shadow) / 0.12), 0 8px 22px -14px rgb(var(--color-postbox-shadow) / 0.4)"
      }
    }
  },
  plugins: []
} satisfies Config;
