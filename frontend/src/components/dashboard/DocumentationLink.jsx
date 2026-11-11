import React from 'react';
import { NavLink } from 'react-router-dom';
import { BookOpen } from 'lucide-react';

export default function DocumentationLink({ onNavigate }) {
  return (
    <div className="pt-4 border-t border-[#E2E5E8] space-y-2">
      {/* Documentation Link */}
      <NavLink
        to="/documentation"
        onClick={onNavigate}
        className={({ isActive }) =>
          `flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors ${
            isActive
              ? 'bg-zinc-100 text-[#111827] font-semibold'
              : 'text-[#64748B] hover:text-[#111827] hover:bg-zinc-50'
          }`
        }
      >
        {({ isActive }) => (
          <>
            <BookOpen
              className={`w-4 h-4 transition-colors ${
                isActive ? 'text-[#52525B]' : 'text-zinc-400'
              }`}
            />
            <span>Documentation</span>
          </>
        )}
      </NavLink>
    </div>
  );
}
