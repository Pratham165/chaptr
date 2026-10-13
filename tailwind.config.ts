import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        ink: {
          950: "#0B0B0D",
          900: "#141416",
          700: "#2A2A2E",
        },
        paper: {
          50: "#F5F3EE",
          400: "#9B968C",
        },
        accent: {
          DEFAULT: "#E8432E",
          red: "#E8432E",
          "red-dim": "#8C2A1D",
          foreground: "#F5F3EE",
        },
        status: {
          reading: "#4A9B7F",
          hold: "#C9A94B",
          done: "#5B6FA8",
          dropped: "#8C867A",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "#E8432E",
          foreground: "#F5F3EE",
        },
        secondary: {
          DEFAULT: "#141416",
          foreground: "#F5F3EE",
        },
        muted: {
          DEFAULT: "#1A1A1E",
          foreground: "#9B968C",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "#E8432E",
        chart: {
          1: "var(--chart-1)",
          2: "var(--chart-2)",
          3: "var(--chart-3)",
          4: "var(--chart-4)",
          5: "var(--chart-5)",
        },
        sidebar: {
          DEFAULT: "#141416",
          foreground: "#F5F3EE",
          primary: "#E8432E",
          "primary-foreground": "#F5F3EE",
          accent: "#2A2A2E",
          "accent-foreground": "#F5F3EE",
          border: "#2A2A2E",
          ring: "#E8432E",
        },
      },
      borderRadius: {
        lg: "4px",
        md: "4px",
        sm: "2px",
      },
    },
  },
  plugins: [],
};
export default config;
