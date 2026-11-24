import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Compass, Home, LayoutDashboard } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../store/authStore';

export default function NotFound() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <div className="relative min-h-screen canvas-grid-pattern flex flex-col items-center justify-center text-center px-4 overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-zinc-300/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-zinc-400/20 blur-3xl" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="relative z-10 flex flex-col items-center"
      >
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 text-white shadow-lg">
          <Compass className="h-7 w-7" />
        </div>

        <h1 className="bg-gradient-to-b from-zinc-900 to-zinc-400 bg-clip-text text-8xl sm:text-9xl font-black tracking-tight text-transparent select-none">
          404
        </h1>

        <h2 className="mt-2 text-2xl sm:text-3xl font-bold text-zinc-900">Lost in the canvas</h2>
        <p className="mt-3 max-w-md text-zinc-500">
          We couldn't find the page you were looking for. It may have been moved, deleted, or the link might be mistyped.
        </p>
        <code className="mt-4 max-w-full truncate rounded-md border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-500">
          {pathname}
        </code>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button variant="outline" size="lg" icon={ArrowLeft} onClick={() => navigate(-1)}>
            Go back
          </Button>
          {isAuthenticated && (
            <Link to="/dashboard">
              <Button variant="secondary" size="lg" icon={LayoutDashboard}>Dashboard</Button>
            </Link>
          )}
          <Link to="/">
            <Button size="lg" icon={Home}>Go home</Button>
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
