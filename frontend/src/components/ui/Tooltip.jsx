import { cn } from '../../utils/helpers';

export function Tooltip({ content, children, side = 'top', className }) {
  if (!content) return children;

  const sideClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <div className="relative group inline-block">
      {children}
      <div
        className={cn(
          'absolute opacity-0 group-hover:opacity-100 transition-opacity duration-200 delay-300 pointer-events-none z-50',
          'px-2 py-1 text-xs font-medium bg-zinc-200 border border-zinc-300 text-zinc-900 rounded-md whitespace-nowrap shadow-lg',
          sideClasses[side],
          className
        )}
      >
        {content}
      </div>
    </div>
  );
}
