import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-btn-default text-btn-default-text hover:bg-btn-default-hover active:bg-btn-default-active disabled:bg-btn-default-disabled disabled:text-btn-default-disabled-text',
        destructive:
          'bg-destructive text-btn-default-text hover:bg-destructive/90 active:bg-destructive/95',
        outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground active:bg-accent/90',
        secondary:
          'bg-btn-secondary text-btn-secondary-text hover:bg-btn-secondary-hover active:bg-btn-secondary-active disabled:bg-btn-secondary-disabled disabled:text-btn-secondary-disabled-text',
        ghost:
          'bg-btn-ghost text-btn-ghost-text hover:bg-btn-ghost-hover-bg active:bg-btn-ghost-active-bg disabled:text-btn-ghost-disabled-text',
        link: 'text-secondary underline-offset-4 hover:text-secondary/80 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
