import React, { useState } from 'react';
import { Mail, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteUsers({ onInvite }) {
  const [emailInput, setEmailInput] = useState('');
  const [error, setError] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const handleInvite = async (e) => {
    e?.preventDefault();
    setError('');
    setSuccessMessage('');

    if (!emailInput.trim()) {
      setError('Please enter at least one email address.');
      return;
    }

    // Split by commas and trim
    const rawTokens = emailInput.split(',').map((t) => t.trim()).filter(Boolean);

    if (rawTokens.length === 0) {
      setError('Please enter at least one email address.');
      return;
    }

    // Validate each email
    const invalidList = rawTokens.filter((email) => !EMAIL_REGEX.test(email));
    if (invalidList.length > 0) {
      setError(`Invalid email address format: ${invalidList.slice(0, 2).join(', ')}${invalidList.length > 2 ? '...' : ''}`);
      return;
    }

    // Simulated invitation network request
    setIsInviting(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 600));

      if (onInvite) {
        onInvite(rawTokens);
      }

      setEmailInput('');
      setSuccessMessage('Invitation sent');
      setTimeout(() => {
        setSuccessMessage('');
      }, 3500);
    } catch (err) {
      setError('Failed to send invitation. Please try again.');
    } finally {
      setIsInviting(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleInvite();
    }
  };

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor="invite-emails-input" className="text-xs font-semibold text-[#111827]">
          Give access
        </label>
        {successMessage && (
          <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1 animate-in fade-in slide-in-from-right-1 duration-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span>{successMessage}</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            id="invite-emails-input"
            type="text"
            value={emailInput}
            onChange={(e) => {
              setEmailInput(e.target.value);
              if (error) setError('');
            }}
            onKeyDown={handleKeyDown}
            placeholder="Emails, comma-separated"
            className="w-full h-9 px-3 text-xs bg-white rounded-xl border border-[#DDE2E5] focus:outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-100 placeholder:text-zinc-400 text-[#111827] transition-all"
          />
        </div>

        <button
          type="button"
          onClick={handleInvite}
          disabled={isInviting || !emailInput.trim()}
          className="h-9 px-4 rounded-xl bg-zinc-600 hover:bg-zinc-700 text-white text-xs font-semibold shadow-xs disabled:opacity-50 disabled:hover:bg-zinc-600 flex items-center justify-center gap-1.5 transition-all shrink-0 cursor-pointer active:scale-95"
        >
          {isInviting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Inviting...</span>
            </>
          ) : (
            <span>Invite</span>
          )}
        </button>
      </div>

      {error && (
        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-rose-600 font-medium animate-in fade-in duration-150">
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

export default InviteUsers;
