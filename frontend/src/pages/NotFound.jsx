import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';

export default function NotFound() {
  return (
    <div className="min-h-screen canvas-grid-pattern flex flex-col items-center justify-center text-center px-4">
      <h1 className="text-8xl font-black text-zinc-900 select-none">404</h1>
      <div className="-mt-8 relative z-10">
        <h2 className="text-2xl font-bold text-zinc-900 mb-2">Page not found</h2>
        <p className="text-zinc-400 mb-8 max-w-sm mx-auto">
          The page you are looking for doesn't exist or has been moved.
        </p>
        <Link to="/">
          <Button size="lg">Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
