import React from 'react';
import { UserAvatar } from './UserAvatar';

export function ProfileHeader({ user }) {
  const name = user?.name || 'User Profile';
  const email = user?.email || '';
  const userId = user?._id || user?.id || '';
  const avatar = user?.avatar || '';

  return (
    <div className="flex items-center gap-3.5 pb-3">
      {/* Real Circular Avatar with Photo / Initial */}
      <UserAvatar name={name} avatar={avatar} size="md" />

      {/* Database User Details */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <h4 className="text-sm font-bold text-[#111827] truncate leading-tight tracking-tight">
            {name}
          </h4>
          {userId && (
            <span
              className="text-[10px] font-mono text-zinc-400 shrink-0 bg-zinc-100/80 px-1.5 py-0.5 rounded border border-zinc-200/60"
              title={`Database User ID: ${userId}`}
            >
              #{userId.slice(-6)}
            </span>
          )}
        </div>

        {email && (
          <p className="text-xs text-zinc-500 truncate mt-1 leading-normal" title={email}>
            {email}
          </p>
        )}
      </div>
    </div>
  );
}

export default ProfileHeader;
