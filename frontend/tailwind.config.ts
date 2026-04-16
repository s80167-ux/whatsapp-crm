import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#075e54",
        accent: "#34b7f1",
        mint: "#dcf8c6",
        whatsapp: {
          deep: "#075e54",
          dark: "#128c7e",
          green: "#25d366",
          soft: "#dcf8c6",
          canvas: "#ece5dd",
          sky: "#34b7f1",
          line: "#d5cdc4",
          muted: "#6b817b"
        }
      },
      boxShadow: {
        glass: "0 8px 24px rgba(0, 0, 0, 0.06)",
        soft: "0 2px 10px rgba(0, 0, 0, 0.05)"
      },
      backdropBlur: {
        glass: "24px"
      }
    }
  },
  plugins: []
} satisfies Config;
