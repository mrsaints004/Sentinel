/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        s: {
          bg: "#f8f9fb",
          white: "#ffffff",
          card: "#ffffff",
          border: "#e5e7eb",
          "border-hover": "#d1d5db",
          accent: "#4f46e5",
          "accent-light": "#eef2ff",
          teal: "#0d9488",
          "teal-light": "#f0fdfa",
          green: "#16a34a",
          "green-light": "#f0fdf4",
          red: "#dc2626",
          "red-light": "#fef2f2",
          yellow: "#d97706",
          "yellow-light": "#fffbeb",
          purple: "#7c3aed",
          text: "#111827",
          "text-secondary": "#4b5563",
          "text-muted": "#9ca3af",
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
