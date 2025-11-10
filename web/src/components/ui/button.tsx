import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-base font-semibold transition-all duration-200 ease-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[var(--primary-dark)] hover:scale-[1.02] active:scale-[0.98] rounded-lg",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:scale-[1.02] active:scale-[0.98] rounded-lg",
        outline:
          "border-2 border-primary bg-transparent text-primary hover:bg-primary hover:text-primary-foreground hover:scale-[1.02] active:scale-[0.98] rounded-lg",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:scale-[1.02] active:scale-[0.98] rounded-lg",
        ghost:
          "hover:bg-muted hover:text-foreground rounded-lg",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-auto px-8 py-3 has-[>svg]:px-6",
        sm: "h-auto px-6 py-2 text-sm has-[>svg]:px-4",
        lg: "h-auto px-12 py-4 text-xl has-[>svg]:px-10",
        icon: "size-10",
        "icon-sm": "size-8",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
