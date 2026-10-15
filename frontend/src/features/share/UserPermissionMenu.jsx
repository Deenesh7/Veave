import React, { useState } from 'react';
import { ChevronDown, Check, UserMinus, ShieldAlert } from 'lucide-react';

export function UserPermissionMenu({ user, onRoleChange, onRemoveRequest }) {
  const [open, setOpen] = useState(false);

  if (user.role === 'Owner') {
    return (
      <span className="text-xs font-semibold text-zinc-500 px-2.5 py-1">
        Owner
      </span>
    );
  }

  const roles = [
    { key: 'Editor', label: 'Editor', desc: 'Can view and edit project files' },
    { key: 'Viewer', label: 'Viewer', desc: 'Can preview and leave comments' },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="px-2 py-1 rounded-lg text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition-colors flex items-center gap-1 cursor-pointer"
      >
        <span>{user.role}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl border border-[#DDE2E5] shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs">
            <div className="px-2.5 py-1 text-[10px] font-mono uppercase text-zinc-400 font-bold border-b border-zinc-100">
              Role
            </div>

            {roles.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => {
                  onRoleChange?.(user.id, r.key);
                  setOpen(false);
                }}
                className={`w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-zinc-50 transition-colors cursor-pointer ${
                  user.role === r.key ? 'text-zinc-600 font-semibold bg-zinc-50/50' : 'text-zinc-700'
                }`}
              >
                <span>{r.label}</span>
                {user.role === r.key && <Check className="w-3 h-3 text-zinc-600" />}
              </button>
            ))}

            <div className="my-1 border-t border-zinc-100" />

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onRemoveRequest?.(user);
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-1.5 text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
            >
              <UserMinus className="w-3.5 h-3.5" />
              <span>Remove access</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default UserPermissionMenu;
