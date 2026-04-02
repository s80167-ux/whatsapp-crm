import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#102033",
        accent: "#5dc9ff",
        mint: "#6fe3c1"
      },
      boxShadow: {
        glass: "0 24px 60px rgba(16, 32, 51, 0.14)",
        soft: "0 10px 30px rgba(16, 32, 51, 0.10)"
      },
      backdropBlur: {
        glass: "24px"
      }
    }
  },
  plugins: []
} satisfies Config;
