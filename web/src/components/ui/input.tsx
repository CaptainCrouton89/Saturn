import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Base styles
        "w-full min-w-0 px-4 py-3 text-base",
        "font-['Inter',sans-serif] text-foreground",
        "bg-card border-2 border-input rounded-lg",
        "transition-all duration-200 ease-out",
        "outline-none",
        // Placeholder
        "placeholder:text-muted-foreground placeholder:opacity-70",
        // Focus state
        "focus:border-ring focus:shadow-[0_0_0_3px_rgba(var(--ring-rgb),0.1)]",
        "focus:ring-ring/10 focus:ring-[3px]",
        // Error state
        "aria-invalid:border-destructive aria-invalid:focus:ring-destructive/10",
        // Selection
        "selection:bg-primary selection:text-primary-foreground",
        // File input specific
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        // Disabled state
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Input }
