import { cn } from '../../utils/helpers';

export function Avatar({ src, alt, fallback, size = 'md', className, ...props }) {
  const sizes = {
    sm: 'h-7 w-7 text-xs',
    md: 'h-9 w-9 text-sm',
    lg: 'h-12 w-12 text-base',
  };

  const getInitials = (name) => {
    if (!name) return '??';
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <div
      className={cn(
        'relative flex items-center justify-center rounded-full bg-zinc-200 text-zinc-400 font-medium overflow-hidden shrink-0',
        sizes[size],
        className
      )}
      {...props}
    >
      {src ? (
        <img src={src} alt={alt || 'Avatar'} className="h-full w-full object-cover" />
      ) : (
        <span>{fallback ? getInitials(fallback) : '??'}</span>
      )}
    </div>
  );
}
