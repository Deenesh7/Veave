import { cn } from '../../utils/helpers';

export function Card({ className, ...props }) {
  return (
    <div
      className={cn('bg-zinc-50 border border-zinc-200 rounded-xl overflow-hidden', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('p-5 flex flex-col gap-1', className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return <h3 className={cn('text-lg font-semibold text-zinc-900', className)} {...props} />;
}

export function CardDescription({ className, ...props }) {
  return <p className={cn('text-sm text-zinc-400', className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn('px-5 pb-5 pt-0', className)} {...props} />;
}

export function CardFooter({ className, ...props }) {
  return <div className={cn('px-5 pb-5 flex items-center pt-0', className)} {...props} />;
}
