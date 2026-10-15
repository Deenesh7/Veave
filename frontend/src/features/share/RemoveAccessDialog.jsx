import React from 'react';
import { UserMinus, AlertTriangle } from 'lucide-react';

export function RemoveAccessDialog({ isOpen, user, onConfirm, onCancel }) {
  if (!isOpen || !user) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
      {/* Dimmed backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-2xs animate-in fade-in duration-150"
        onClick={onCancel} 
      />

      {/* Confirmation Box */}
      <div 
        className="relative bg-white rounded-2xl border border-[#DDE2E5] shadow-2xl p-5 w-full max-w-sm z-70 animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center shrink-0">
            <UserMinus className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-[#111827]">Remove access for this user?</h4>
            <p className="text-xs text-zinc-500 truncate mt-0.5" title={user.email}>
              {user.email}
            </p>
          </div>
        </div>

        <p className="text-xs text-zinc-600 leading-relaxed mb-4">
          This user will immediately lose access to edit or collaborate on this project. You can re-invite them at any time.
        </p>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded-xl border border-[#DDE2E5] bg-white hover:bg-zinc-50 text-xs font-semibold text-zinc-700 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-all shadow-xs active:scale-95 cursor-pointer"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

export default RemoveAccessDialog;
