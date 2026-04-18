/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Norse gold/bronze — Valheim accent palette
        brand: {
          50: "#fbf7eb",
          100: "#f5eacc",
          200: "#ecd49b",
          300: "#dfb860",
          400: "#d4a03a",
          500: "#c08a26",
          600: "#a56e1e",
          700: "#87531c",
          800: "#71431e",
          900: "#5f381d",
          950: "#371c0d",
        },
        // Blue-shifted Nordic darks (overrides default zinc)
        zinc: {
          50: "#f4f6fa",
          100: "#e4e8f0",
          200: "#ccd3e0",
          300: "#a4afc4",
          400: "#7685a2",
          500: "#566585",
          600: "#45516d",
          700: "#38425a",
          800: "#1e2740",
          900: "#131a2c",
          950: "#0a0f1a",
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
