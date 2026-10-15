import { cn } from '../../utils/helpers';

export function Separator({ orientation = 'horizontal', className, ...props }) {
  return (
    <div
      className={cn(
        'bg-zinc-200 shrink-0',
        orientation === 'horizontal' ? 'h-px w-full' : 'w-px h-full',
        className
      )}
      {...props}
    />
  );
}
