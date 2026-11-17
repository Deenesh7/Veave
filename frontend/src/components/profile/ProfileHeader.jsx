import React from 'react';
import { UserAvatar } from './UserAvatar';

export function ProfileHeader({ user }) {
  const name = user?.name || 'User Profile';
  const email = user?.email || '';
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
