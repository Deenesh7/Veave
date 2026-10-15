import React from 'react';
import { UserPermissionMenu } from './UserPermissionMenu';

export function AccessUserList({ users = [], onRoleChange, onRemoveRequest }) {
  if (!users || users.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-zinc-400">
        No other collaborators with direct access.
      </div>
    );
  }

  // Consistent pleasant avatar colors
  const avatarColors = [
    'bg-gradient-to-tr from-zinc-500 to-indigo-600',
    'bg-gradient-to-tr from-violet-500 to-purple-600',
    'bg-gradient-to-tr from-emerald-500 to-teal-600',
    'bg-gradient-to-tr from-amber-500 to-orange-600',
    'bg-gradient-to-tr from-rose-500 to-pink-600'
  ];

  return (
    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5 scrollbar-thin">
      {users.map((u, index) => {
        const initial = (u.name || u.email || 'U').charAt(0).toUpperCase();
        const colorClass = avatarColors[index % avatarColors.length];

        return (
          <div
            key={u.id || u.email}
            className="flex items-center justify-between py-2 px-2.5 rounded-xl hover:bg-zinc-50 transition-colors"
          >
            {/* Left: Avatar & Identity */}
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div
                className={`w-7 h-7 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0 shadow-2xs ${colorClass}`}
              >
                {initial}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 leading-tight">
                  <p className="text-xs font-semibold text-[#111827] truncate">
                    {u.email}
                  </p>
                  {u.isYou && (
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-sm bg-zinc-100 text-zinc-500 font-bold">
                      you
                    </span>
                  )}
                </div>
                {u.name && u.name !== u.email && (
                  <p className="text-[10px] text-zinc-400 truncate mt-0.5">
                    {u.name}
                  </p>
                )}
              </div>
            </div>

            {/* Right: Role Dropdown / Tag */}
            <div className="shrink-0 pl-2">
              <UserPermissionMenu
                user={u}
                onRoleChange={onRoleChange}
                onRemoveRequest={onRemoveRequest}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default AccessUserList;
