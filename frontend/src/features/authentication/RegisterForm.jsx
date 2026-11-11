import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { Mail, User } from 'lucide-react';
import { Input } from '../../components/ui/Input';
import { useAuthEntrance, PasswordInput, PasswordStrength, MatchHint, AuthError, SubmitButton, OAuthButtons } from './AuthParts';

export function RegisterForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationError, setValidationError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const { register, error: storeError, clearError } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    const oauthError = searchParams.get('error');

    if (token) {
      useAuthStore.getState().loginWithToken(token).then(() => {
        navigate('/dashboard', { replace: true });
      }).catch((err) => {
        console.error('OAuth registration failed:', err);
      });
    } else if (oauthError) {
      useAuthStore.setState({ error: oauthError });
    }
  }, [searchParams, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setValidationError('');
    if (storeError) clearError();

    if (password.length < 8) {
      setValidationError('Password must be at least 8 characters long');
      return;
    }
    if (password !== confirmPassword) {
      setValidationError('Passwords do not match');
      return;
    }

    setIsSubmitting(true);
    try {
      await register(name, email, password);
      navigate('/dashboard');
    } catch (err) {
      // Error is handled by store
    } finally {
      setIsSubmitting(false);
    }
  };

  const error = validationError || storeError;

  const formRef = useAuthEntrance();

  return (
    <div ref={formRef} className="w-full">
      <div data-auth className="mb-7">
        <h2 className="text-3xl font-bold tracking-tight text-zinc-900">Create your account</h2>
        <p className="text-sm text-zinc-500 mt-1.5">Start on the free plan. No credit card needed.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div data-auth>
          <Input
            label="Full Name"
            type="text"
            icon={User}
            autoComplete="name"
            placeholder="John Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
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
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <PasswordStrength password={password} />
        </div>
        <div data-auth>
          <PasswordInput
            label="Confirm Password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          <MatchHint password={password} confirm={confirmPassword} />
        </div>

        <AuthError message={error} />

        <div data-auth className="pt-1">
          <SubmitButton loading={isSubmitting}>Create Account</SubmitButton>
        </div>
      </form>

      <div data-auth className="mt-6">
        <OAuthButtons />
      </div>

      <div data-auth className="mt-7 text-center">
        <span className="text-sm text-zinc-500">
          Already have an account?{' '}
          <Link to="/login" className="text-zinc-900 hover:underline underline-offset-4 font-semibold">
            Sign in
          </Link>
        </span>
      </div>
    </div>
  );
}
