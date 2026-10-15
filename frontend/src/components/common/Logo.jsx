import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { cn } from '../../utils/helpers';

export function Logo({ size = 'md', showText = true, className }) {
  const sizes = {
    sm: { icon: 'w-5 h-5', text: 'text-lg' },
    md: { icon: 'w-6 h-6', text: 'text-xl' },
    lg: { icon: 'w-8 h-8', text: 'text-3xl' },
  };

  return (
    <Link to="/" className={cn('flex items-center gap-2 group', className)}>
      <div className="relative flex items-center justify-center">
        <div className="absolute inset-0 bg-indigo-500/20 blur-md rounded-full group-hover:bg-indigo-500/30 transition-colors" />
        <Sparkles className={cn('text-indigo-400 relative z-10', sizes[size].icon)} />
      </div>
      {showText && (
        <span
          className={cn(
            'font-bold tracking-tight text-zinc-900',
            sizes[size].text
          )}
        >
          Veave
        </span>
      )}
    </Link>
  );
}
