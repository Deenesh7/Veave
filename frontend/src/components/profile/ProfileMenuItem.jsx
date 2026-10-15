import React from 'react';

export function ProfileMenuItem({
  icon: Icon,
  label,
  onClick,
  isDestructive = false,
  badge = null
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-3 py-2.5 rounded-xl text-xs sm:text-[13px] font-medium flex items-center justify-between transition-all text-left cursor-pointer group ${
        isDestructive
          ? 'text-rose-600 hover:text-rose-700 hover:bg-rose-50/70'
          : 'text-zinc-700 hover:text-[#111827] hover:bg-zinc-100/70'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <Icon
            className={`w-4 h-4 shrink-0 transition-colors ${
              isDestructive
                ? 'text-rose-500 group-hover:text-rose-600'
                : 'text-zinc-400 group-hover:text-zinc-700'
            }`}
          />
        )}
        <span className="truncate">{label}</span>
      </div>

      {badge && (
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500 font-bold">
          {badge}
        </span>
      )}
    </button>
  );
}

export default ProfileMenuItem;
