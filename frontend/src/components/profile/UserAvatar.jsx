import React, { useState } from 'react';

export function UserAvatar({ name = '', avatar = '', size = 'md', className = '' }) {
  const [imageError, setImageError] = useState(false);
  const initial = (name || 'U').charAt(0).toUpperCase();

  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base'
  };

  const selectedSizeClass = sizeClasses[size] || sizeClasses.md;

  if (avatar && !imageError) {
    return (
      <img
        src={avatar}
        alt={name || 'User Avatar'}
        onError={() => setImageError(true)}
        className={`rounded-full object-cover shrink-0 select-none shadow-xs border border-white/20 ${selectedSizeClass} ${className}`}
        title={name}
      />
    );
  }

  return (
    <div
      className={`rounded-full bg-gradient-to-tr from-zinc-600 to-indigo-600 text-white font-bold flex items-center justify-center shrink-0 select-none shadow-xs ring-1 ring-black/5 ${selectedSizeClass} ${className}`}
      title={name}
    >
      {initial}
    </div>
  );
}

export default UserAvatar;
