// Based on shadcn/ui (https://github.com/shadcn-ui/ui), changed for this project.
// Copyright (c) 2023 shadcn. Licensed under the MIT License, see THIRD-PARTY-NOTICES.md.
//
// SPDX-License-Identifier: MIT

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 min-h-9',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-white/10 text-foreground hover:bg-white/15 border border-white/10',
        ghost: 'text-foreground hover:bg-white/10',
        outline: 'border border-input bg-transparent hover:bg-white/10',
        destructive: 'border border-destructive/60 text-destructive hover:bg-destructive/10',
      },
      size: { default: 'px-4 py-2', sm: 'px-3 text-xs min-h-8', icon: 'size-9 p-0' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  },
)
Button.displayName = 'Button'
