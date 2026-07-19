/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Norse gold/bronze accent — the whole `brand` ramp is CSS-variable
        // backed so the biome theme system can re-tint it at runtime
        // (see src/theme/apply.ts). Defaults live in src/index.css.
        brand: {
          50: "rgb(var(--ml-brand-50) / <alpha-value>)",
          100: "rgb(var(--ml-brand-100) / <alpha-value>)",
          200: "rgb(var(--ml-brand-200) / <alpha-value>)",
          300: "rgb(var(--ml-brand-300) / <alpha-value>)",
          400: "rgb(var(--ml-brand-400) / <alpha-value>)",
          500: "rgb(var(--ml-brand-500) / <alpha-value>)",
          600: "rgb(var(--ml-brand-600) / <alpha-value>)",
          700: "rgb(var(--ml-brand-700) / <alpha-value>)",
          800: "rgb(var(--ml-brand-800) / <alpha-value>)",
          900: "rgb(var(--ml-brand-900) / <alpha-value>)",
          950: "rgb(var(--ml-brand-950) / <alpha-value>)",
        },
        // Blue-shifted Nordic darks (overrides default zinc). Only the three
        // deep surface stops (base/panel/border) are variable-backed so the
        // biome themes can tint them; the text-tier stops stay neutral so
        // contrast never regresses across biomes.
        zinc: {
          50: "#f4f6fa",
          100: "#e4e8f0",
          200: "#ccd3e0",
          300: "#a4afc4",
          400: "#7685a2",
          500: "#566585",
          600: "#45516d",
          700: "#38425a",
          800: "rgb(var(--ml-zinc-800) / <alpha-value>)",
          900: "rgb(var(--ml-zinc-900) / <alpha-value>)",
          950: "rgb(var(--ml-zinc-950) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        // Norse display font (valheimgame.com style) — for headings, titles, logo only.
        // Never use for body copy; it's a display face, not a reading face.
        norse: ["Norse", "serif"],
      },
    },
  },
  plugins: [],
};
