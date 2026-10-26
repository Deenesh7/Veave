import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Home, 
  BookOpen, 
  Settings, 
  Building2, 
  CreditCard, 
  LogOut 
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { UserAvatar } from './UserAvatar';
import { ProfileHeader } from './ProfileHeader';
import { PlanBadge } from './PlanBadge';
import { CreditsBadge } from './CreditsBadge';
import { ProfileMenuItem } from './ProfileMenuItem';
import { LogoutConfirmation } from './LogoutConfirmation';

export function ProfileMenu() {
  const navigate = useNavigate();
  const { user: authUser, logout, fetchProfile } = useAuthStore();

  // State management per prompt specifications
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isLogoutDialogOpen, setIsLogoutDialogOpen] = useState(false);
  
  // Fetch real user profile from MongoDB if not already present
  useEffect(() => {
    if (!authUser && fetchProfile) {
      fetchProfile();
    }
  }, [authUser, fetchProfile]);

  // Helper to format plan name from DB cleanly
  const formatPlanName = (planStr) => {
    if (!planStr) return 'Free Tier';
    if (planStr.toLowerCase().includes('plan')) return planStr;
    return `${planStr.charAt(0).toUpperCase() + planStr.slice(1)} Plan`;
  };

  // Real user data fetched directly from database
  const currentUser = authUser ? {
    name: authUser.name,
    email: authUser.email,
    id: authUser._id || authUser.id,
    plan: formatPlanName(authUser.plan || authUser.subscription?.tier),
    avatar: authUser.avatar
  } : {
    name: 'Account',
    email: 'Fetching profile...',
    id: '',
    plan: 'Loading...',
    avatar: ''
  };

  // Credit balance directly from MongoDB user document
  const credits = typeof authUser?.credits === 'number'
    ? authUser.credits
    : (authUser?.subscription?.creditsRemaining ?? 0);

  const menuRef = useRef(null);

  // Close on outside click and Escape key
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsProfileMenuOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsProfileMenuOpen(false);
      }
    };

    if (isProfileMenuOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isProfileMenuOpen]);

  const handleNavigate = (path) => {
    setIsProfileMenuOpen(false);
    navigate(path);
  };

  const handleConfirmLogout = () => {
    setIsLogoutDialogOpen(false);
    setIsProfileMenuOpen(false);
    logout();
    navigate('/login');
  };

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      {/* Profile Avatar Button Trigger in Top-Right Header */}
      <button
        type="button"
        onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
        className="rounded-full p-0.5 hover:ring-2 hover:ring-zinc-200 focus:outline-none transition-all cursor-pointer select-none"
        title={currentUser.name ? `${currentUser.name} (${currentUser.email})` : 'Account Profile'}
      >
        <UserAvatar name={currentUser.name} avatar={currentUser.avatar} size="md" />
      </button>

      {/* Profile Dropdown Panel with Generous Spacing */}
      {isProfileMenuOpen && (
        <div
          className="absolute right-0 top-full mt-2.5 w-[340px] sm:w-[356px] bg-white rounded-2xl border border-[#E2E5E8] shadow-[0_16px_40px_rgba(0,0,0,0.09)] p-4 sm:p-4.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150 select-none"
          role="menu"
        >
          {/* 1. User Profile Section */}
          <ProfileHeader user={currentUser} />

          {/* 2. Plan and Dynamic Credits Card */}
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3.5 py-2.5 flex items-center justify-between my-2.5 shadow-2xs">
            <PlanBadge plan={currentUser.plan} />
            <CreditsBadge credits={credits} />
          </div>

          {/* 3. Menu Navigation Groups */}
          <div className="space-y-0.5 pt-1">
            <ProfileMenuItem
              icon={Home}
              label="Home"
              onClick={() => handleNavigate('/')}
            />

            <ProfileMenuItem
              icon={BookOpen}
              label="Documentation"
              onClick={() => handleNavigate('/documentation')}
            />

            <div className="my-2 border-b border-zinc-100" />

            <ProfileMenuItem
              icon={Settings}
              label="Settings"
              onClick={() => handleNavigate('/settings')}
            />

            <ProfileMenuItem
              icon={Building2}
              label="Manage Workspace"
              onClick={() => handleNavigate('/workspace')}
            />

            <ProfileMenuItem
              icon={CreditCard}
              label="Billing & Subscription"
              onClick={() => handleNavigate('/billing')}
            />

            <div className="my-2 border-b border-zinc-100" />

            {/* Logout Option */}
            <ProfileMenuItem
              icon={LogOut}
              label="Log out"
              isDestructive
              onClick={() => {
                setIsProfileMenuOpen(false);
                setIsLogoutDialogOpen(true);
              }}
            />
          </div>
        </div>
      )}

      {/* Logout Confirmation Dialog */}
      <LogoutConfirmation
        isOpen={isLogoutDialogOpen}
        onClose={() => setIsLogoutDialogOpen(false)}
        onConfirm={handleConfirmLogout}
      />
    </div>
  );
}

export default ProfileMenu;
