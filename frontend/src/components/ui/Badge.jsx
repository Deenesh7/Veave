import { cn } from '../../utils/helpers';

export function Badge({ className, variant = 'default', children, ...props }) {
  const variants = {
    default: 'bg-zinc-200 text-zinc-700',
    success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    error: 'bg-red-500/10 text-red-400 border-red-500/20',
    info: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border border-transparent',
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
