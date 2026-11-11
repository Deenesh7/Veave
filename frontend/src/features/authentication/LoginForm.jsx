import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { Mail } from 'lucide-react';
import { Input } from '../../components/ui/Input';
import { useAuthEntrance, PasswordInput, AuthError, SubmitButton, OAuthButtons } from './AuthParts';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, error, clearError } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    const oauthError = searchParams.get('error');

    if (token) {
      useAuthStore.getState().loginWithToken(token).then(() => {
        navigate('/dashboard', { replace: true });
      }).catch((err) => {
        console.error('OAuth login failed:', err);
      });
    } else if (oauthError) {
      useAuthStore.setState({ error: oauthError }); // searchParams.get() already decodes it
    } else if (searchParams.get('expired')) {
      useAuthStore.setState({ error: 'Please log in to continue. Your session has ended or you need an account for this action.' });
    }
  }, [searchParams, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (error) clearError();
    setIsSubmitting(true);
    try {
      await login(email, password);
      const redirect = searchParams.get('redirect');
      navigate(redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/dashboard');
    } catch (err) {
      // Error is handled by store
    } finally {
      setIsSubmitting(false);
    }
  };

  const formRef = useAuthEntrance();

  return (
    <div ref={formRef} className="w-full">
      <div data-auth className="mb-7">
        <h2 className="text-3xl font-bold tracking-tight text-zinc-900">Welcome back</h2>
        <p className="text-sm text-zinc-500 mt-1.5">Log in to keep building your websites.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div data-auth>
          <Input
            label="Email"
            type="email"
            icon={Mail}
            autoComplete="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div data-auth>
          <PasswordInput
            label="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <AuthError message={error} />

        <div data-auth className="pt-1">
          <SubmitButton loading={isSubmitting}>Sign In</SubmitButton>
        </div>
      </form>

      <div data-auth className="mt-6">
        <OAuthButtons />
      </div>

      <div data-auth className="mt-7 text-center space-y-2 flex flex-col">
        <Link to="#" className="text-xs text-zinc-500 hover:text-zinc-800 transition-colors">
          Forgot password?
        </Link>
        <span className="text-sm text-zinc-500">
          Don't have an account?{' '}
          <Link to="/register" className="text-zinc-900 hover:underline underline-offset-4 font-semibold">
            Sign up
          </Link>
        </span>
      </div>
    </div>
  );
}
