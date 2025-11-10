import type { Config } from "tailwindcss"

const config: Config = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Semantic colors for shadcn/ui
        background: "hsl(0 0% 100%)",
        foreground: "hsl(0 0% 13.3%)",
        card: "hsl(0 0% 100%)",
        "card-foreground": "hsl(0 0% 13.3%)",
        popover: "hsl(0 0% 100%)",
        "popover-foreground": "hsl(0 0% 13.3%)",
        muted: "hsl(0 0% 96.1%)",
        "muted-foreground": "hsl(0 0% 45.1%)",
        accent: "hsl(0 0% 9.02%)",
        "accent-foreground": "hsl(0 0% 98%)",
        destructive: "hsl(0 84.2% 60.2%)",
        "destructive-foreground": "hsl(0 0% 98%)",
        border: "hsl(0 0% 89.8%)",
        input: "hsl(0 0% 89.8%)",
        ring: "hsl(0 0% 13.3%)",
        // Project colors
        beige: "hsl(38, 100%, 95%)",
        primary: "hsl(21, 82%, 55%)",
        success: "hsl(142, 71%, 45%)",
        "text-primary": "hsl(0, 0%, 13.3%)",
        "text-secondary": "hsl(0, 0%, 45.1%)",
      },
      fontFamily: {
        serif: ["Merriweather", "serif"],
      },
    },
  },
  plugins: [],
}

export default config
