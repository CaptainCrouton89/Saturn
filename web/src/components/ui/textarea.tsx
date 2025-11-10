import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // Base styles
        "w-full min-w-0 px-4 py-3 text-base min-h-[120px]",
        "font-['Inter',sans-serif] text-foreground",
        "bg-card border-2 border-input rounded-lg",
        "transition-all duration-200 ease-out",
        "outline-none resize-y",
        // Placeholder
        "placeholder:text-muted-foreground placeholder:opacity-70",
        // Focus state
        "focus:border-ring focus:ring-ring/10 focus:ring-[3px]",
        // Error state
        "aria-invalid:border-destructive aria-invalid:focus:ring-destructive/10",
        // Selection
        "selection:bg-primary selection:text-primary-foreground",
        // Disabled state
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
