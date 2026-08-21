/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: {
          DEFAULT: "#f2ead9",
          dim: "#cfc6b4", // muted/secondary text on dark backgrounds
        },
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translate(-50%, -4px)" },
          "100%": { opacity: "1", transform: "translate(-50%, 0)" },
        },
      },
      animation: {
        fadeIn: "fadeIn 0.15s ease-out forwards",
      },
    },
  },
  plugins: [],
};
