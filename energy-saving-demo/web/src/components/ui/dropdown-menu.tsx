// Based on shadcn/ui (https://github.com/shadcn-ui/ui), changed for this project.
// Copyright (c) 2023 shadcn. Licensed under the MIT License, see THIRD-PARTY-NOTICES.md.
//
// SPDX-License-Identifier: MIT

import * as React from 'react'
import * as M from '@radix-ui/react-dropdown-menu'
import { Circle } from 'lucide-react'
import { cn } from '@/lib/utils'

export const DropdownMenu = M.Root
export const DropdownMenuTrigger = M.Trigger
export const DropdownMenuRadioGroup = M.RadioGroup

export const DropdownMenuContent = React.forwardRef<React.ElementRef<typeof M.Content>, React.ComponentPropsWithoutRef<typeof M.Content>>(
  ({ className, sideOffset = 10, ...props }, ref) => (
    <M.Portal>
      <M.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-56 overflow-hidden rounded-2xl border border-[#2f7bff]/40 bg-[#07163a]/95 p-1.5 text-foreground shadow-2xl backdrop-blur-xl',
          className,
        )}
        {...props}
      />
    </M.Portal>
  ),
)
DropdownMenuContent.displayName = 'DropdownMenuContent'

const item = 'relative flex min-h-10 cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 text-sm outline-none data-[highlighted]:bg-white/10'

export const DropdownMenuItem = React.forwardRef<React.ElementRef<typeof M.Item>, React.ComponentPropsWithoutRef<typeof M.Item> & { current?: boolean }>(
  ({ className, current, ...props }, ref) => <M.Item ref={ref} className={cn(item, current && 'font-semibold text-primary', className)} {...props} />,
)
DropdownMenuItem.displayName = 'DropdownMenuItem'

export const DropdownMenuRadioItem = React.forwardRef<React.ElementRef<typeof M.RadioItem>, React.ComponentPropsWithoutRef<typeof M.RadioItem>>(
  ({ className, children, ...props }, ref) => (
    <M.RadioItem ref={ref} className={cn(item, className)} {...props}>
      <M.ItemIndicator className="absolute right-3">
        <Circle className="size-2.5 fill-primary text-primary" aria-hidden="true" />
      </M.ItemIndicator>
      {children}
    </M.RadioItem>
  ),
)
DropdownMenuRadioItem.displayName = 'DropdownMenuRadioItem'

export const DropdownMenuLabel = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof M.Label>) => (
  <M.Label className={cn('px-3 pb-1 pt-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground', className)} {...props} />
)

export const DropdownMenuSeparator = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof M.Separator>) => (
  <M.Separator className={cn('my-1.5 h-px bg-white/10', className)} {...props} />
)
