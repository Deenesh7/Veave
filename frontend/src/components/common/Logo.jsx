import { Link } from 'react-router-dom';
import { cn } from '../../utils/helpers';

// The Veave logo image already contains the wordmark, so `showText` is kept only for call-site compatibility.
export function Logo({ size = 'md', className }) {
  const sizes = {
    sm: 'w-9 h-9',
    md: 'w-11 h-11',
    lg: 'w-16 h-16',
  };

  return (
    <Link to="/" aria-label="Veave" className={cn('flex items-center group', className)}>
      <img src="/veave-logo.png" alt="Veave" className={cn('object-contain', sizes[size])} />
    </Link>
  );
}
