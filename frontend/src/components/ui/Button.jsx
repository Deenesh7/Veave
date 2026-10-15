import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/helpers';

export const Button = forwardRef(
  ({ className, variant = 'default', size = 'md', loading, disabled, icon: Icon, type = 'button', children, ...props }, ref) => {
    const variants = {
      default: 'bg-zinc-900 hover:bg-black text-white shadow-sm',
      secondary: 'bg-zinc-200 hover:bg-zinc-300 text-zinc-900 shadow-sm',
      ghost: 'bg-transparent hover:bg-zinc-200 text-zinc-700',
      danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm',
      outline: 'border border-zinc-300 hover:bg-zinc-200 text-zinc-700',
    };

    const sizes = {
      sm: 'h-8 px-3 text-sm gap-1.5 rounded-md',
      md: 'h-9 px-4 text-sm gap-2 rounded-lg',
      lg: 'h-11 px-6 text-base gap-2 rounded-lg',
      icon: 'h-9 w-9 flex items-center justify-center p-0 rounded-lg',
    };

    return (
      <button
        ref={ref}
        type={type}
        disabled={loading || disabled}
        className={cn(
          'inline-flex items-center justify-center font-medium transition-colors',
          'focus-visible:ring-2 ring-indigo-500 ring-offset-1 ring-offset-zinc-950 outline-none',
          'disabled:opacity-50 disabled:pointer-events-none',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {!loading && Icon && <Icon className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
