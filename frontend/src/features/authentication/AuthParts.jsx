import { useState, useRef, useLayoutEffect } from 'react';
import gsap from 'gsap';
import { motion, AnimatePresence } from 'framer-motion';
import { API_URL } from '../../config';
import { Eye, EyeOff, Lock, AlertCircle, Check } from 'lucide-react';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { cn } from '../../utils/helpers';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Staggers every `[data-auth]` element of a form in when the form mounts (login and register both use it). */
export function useAuthEntrance() {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (reducedMotion()) return undefined;
    const ctx = gsap.context(() => {
      gsap.from('[data-auth]', {
        y: 22,
        opacity: 0,
        duration: 0.6,
        ease: 'power3.out',
        stagger: 0.07,
        clearProps: 'transform,opacity',
      });
    }, ref);
    return () => ctx.revert();
  }, []);
  return ref;
}

/** Password field with a show/hide toggle. */
export function PasswordInput({ label, value, onChange, placeholder = '••••••••', autoComplete, ...rest }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        label={label}
        type={visible ? 'text' : 'password'}
        icon={Lock}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        className="pr-10"
        required
        {...rest}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute right-2.5 bottom-2.5 text-zinc-400 hover:text-zinc-700 transition-colors"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={visible ? 'hide' : 'show'}
            initial={{ opacity: 0, scale: 0.7, rotate: -20 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.7, rotate: 20 }}
            transition={{ duration: 0.12 }}
            className="block"
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </motion.span>
        </AnimatePresence>
      </button>
    </div>
  );
}

function scorePassword(pw) {
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 14) score += 1;
  return score;
}

const STRENGTH = [
  { label: 'Too short', bar: 'bg-red-400', text: 'text-red-500' },
  { label: 'Weak', bar: 'bg-red-400', text: 'text-red-500' },
  { label: 'Fair', bar: 'bg-amber-400', text: 'text-amber-600' },
  { label: 'Good', bar: 'bg-emerald-400', text: 'text-emerald-600' },
  { label: 'Strong', bar: 'bg-emerald-500', text: 'text-emerald-600' },
];

/** Four-segment strength meter under the password field. */
export function PasswordStrength({ password }) {
  const score = password ? scorePassword(password) : 0;
  const level = STRENGTH[password ? score : 0];
  return (
    <AnimatePresence initial={false}>
      {password && (
        <motion.div
          key="strength"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className="flex items-center gap-2 pt-1">
            <div className="flex flex-1 gap-1">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-1 flex-1 rounded-full bg-zinc-200 overflow-hidden">
                  <motion.div
                    className={cn('h-full rounded-full', level.bar)}
                    initial={false}
                    animate={{ width: score >= i ? '100%' : '0%' }}
                    transition={{ duration: 0.25 }}
                  />
                </div>
              ))}
            </div>
            <span className={cn('text-[11px] font-medium w-14 text-right', level.text)}>{level.label}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Small "passwords match" hint. */
export function MatchHint({ password, confirm }) {
  const show = confirm.length > 0;
  const match = password === confirm;
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.p
          key={match ? 'ok' : 'no'}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className={cn('flex items-center gap-1 text-[11px] font-medium mt-1.5', match ? 'text-emerald-600' : 'text-red-500')}
        >
          {match ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
          {match ? 'Passwords match' : 'Passwords do not match yet'}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

/** Error banner that slides in and out, and shakes once when a new error appears. */
export function AuthError({ message }) {
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.div
          key={message}
          role="alert"
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto', x: [0, -6, 6, -4, 4, 0] }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.35 }}
          className="overflow-hidden"
        >
          <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{message}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Submit button with a hover lift and a press effect. */
export function SubmitButton({ loading, children }) {
  return (
    <motion.div whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }} transition={{ duration: 0.12 }}>
      <Button type="submit" size="lg" className="w-full" loading={loading}>
        {children}
      </Button>
    </motion.div>
  );
}

/** "Or continue with" divider and the Google / Apple buttons (both go to the backend OAuth flow). */
export function OAuthButtons() {
  const go = (provider) => () => {
    window.location.href = `${API_URL}/auth/${provider}`;
  };

  return (
    <div>
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-zinc-200" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-white px-3 text-zinc-500">Or continue with</span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {(
          <motion.div whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}>
            <Button variant="outline" size="lg" type="button" onClick={go('google')} className="w-full gap-2 bg-white">
              <svg className="h-4 w-4" aria-hidden="true" viewBox="0 0 24 24">
                <path d="M12.0003 4.75C13.7703 4.75 15.3553 5.36002 16.6053 6.54998L20.0303 3.125C17.9502 1.19 15.2353 0 12.0003 0C7.31028 0 3.25527 2.69 1.28027 6.60998L5.27028 9.70498C6.21525 6.86002 8.87028 4.75 12.0003 4.75Z" fill="#EA4335" />
                <path d="M23.49 12.275C23.49 11.49 23.415 10.73 23.3 10H12V14.51H18.47C18.18 15.99 17.34 17.25 16.08 18.1L19.945 21.1C22.2 19.01 23.49 15.92 23.49 12.275Z" fill="#4285F4" />
                <path d="M5.26498 14.2949C5.02498 13.5699 4.88501 12.7999 4.88501 11.9999C4.88501 11.1999 5.01998 10.4299 5.26498 9.7049L1.275 6.60986C0.46 8.22986 0 10.0599 0 11.9999C0 13.9399 0.46 15.7699 1.28 17.3899L5.26498 14.2949Z" fill="#FBBC05" />
                <path d="M12.0004 24.0001C15.2404 24.0001 17.9654 22.935 19.9454 21.095L16.0804 18.095C15.0054 18.82 13.6204 19.245 12.0004 19.245C8.8704 19.245 6.21537 17.135 5.26538 14.29L1.27539 17.385C3.25539 21.31 7.3104 24.0001 12.0004 24.0001Z" fill="#34A853" />
              </svg>
              Google
            </Button>
          </motion.div>
        )}
        {(
          <motion.div whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}>
            <Button variant="outline" size="lg" type="button" onClick={go('apple')} className="w-full gap-2 bg-white">
              <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.04 2.26-.74 3.58-.79 2.12-.04 3.75 1.05 4.8 2.53-4.14 2.19-3.27 7.23.63 8.87-1.05 2.15-2.22 3.65-4.09 1.56z" />
                <path d="M12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.02 4.5-3.74 4.25z" />
              </svg>
              Apple
            </Button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
