import { cn } from '../../utils/helpers';

export function ScrollArea({ children, className, ...props }) {
  return (
    <div className={cn('overflow-auto', className)} {...props}>
      {children}
    </div>
  );
}
