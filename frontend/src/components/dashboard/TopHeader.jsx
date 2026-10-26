import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Sparkles, Menu, X } from 'lucide-react';
import WorkspaceSelector from './WorkspaceSelector';
import { ProfileMenu } from '../profile/ProfileMenu';
import NotificationBell from '../../features/collaboration/NotificationBell';
import { useCollabStore } from '../../store/collabStore';
import { collaborationService, apiErrorMessage } from '../../services/collaborationService';

export default function TopHeader({ onToggleMobileMenu, mobileMenuOpen }) {
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invited, setInvited] = useState(false);
  const [inviteGroupId, setInviteGroupId] = useState('');
  const [inviteError, setInviteError] = useState(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const navigate = useNavigate();
  const { groups, fetchGroups } = useCollabStore();
  const adminGroups = groups.filter((g) => g.myStatus === 'active' && ['owner', 'admin'].includes(g.myRole));

  useEffect(() => {
    if (!inviteModalOpen) return;
    setInviteError(null);
    fetchGroups();
  }, [inviteModalOpen, fetchGroups]);

  useEffect(() => {
    if (!adminGroups.some((g) => g.id === inviteGroupId)) setInviteGroupId(adminGroups[0]?.id || '');
  }, [adminGroups.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sends a real group invitation (the invitee must accept it before they join).
  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail || !inviteGroupId) return;
    setInviteBusy(true);
    setInviteError(null);
    try {
      await collaborationService.inviteToGroup(inviteGroupId, { email: inviteEmail });
      setInvited(true);
      setTimeout(() => {
        setInvited(false);
        setInviteEmail('');
        setInviteModalOpen(false);
      }, 1500);
    } catch (err) {
      setInviteError(apiErrorMessage(err, 'Could not send the invitation.'));
    } finally {
      setInviteBusy(false);
    }
  };

  return (
    <>
      <header className="h-14 bg-white border-b border-[#E2E5E8] fixed top-0 left-0 right-0 z-40 px-4 sm:px-6 flex items-center justify-between select-none">
        {/* Left Side */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Mobile menu trigger */}
          <button
            onClick={onToggleMobileMenu}
            className="md:hidden p-1.5 rounded-lg text-zinc-600 hover:bg-zinc-100 border border-[#E2E5E8]"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>

          {/* Veave Logo & Brand */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#52525B] to-zinc-600 flex items-center justify-center text-white shadow-xs">
              <Sparkles className="w-4 h-4 fill-white text-white" />
            </div>
            <span className="font-bold text-base tracking-tight text-[#111827]">
              Veave
            </span>
          </div>

          {/* Separator */}
          <span className="text-zinc-300 font-light mx-1 sm:mx-1.5 text-sm">/</span>

          {/* Workspace Selector */}
          <WorkspaceSelector />
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-3">
          {/* Invite Team Button */}
          <button
            onClick={() => setInviteModalOpen(true)}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E2E5E8] text-xs font-semibold text-[#111827] hover:bg-zinc-50 hover:border-zinc-300 transition-all shadow-2xs active:scale-95"
          >
            <UserPlus className="w-3.5 h-3.5 text-zinc-500" />
            <span>Invite Team</span>
          </button>

          <NotificationBell />

          {/* Circular User Avatar with Profile Dropdown */}
          <ProfileMenu />
        </div>
      </header>

      {/* Invite Modal */}
      {inviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl border border-[#E2E5E8] shadow-2xl p-6 w-full max-w-md animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-[#52525B]" />
                <h3 className="text-sm font-bold text-[#111827]">Invite teammates to a group</h3>
              </div>
              <button 
                onClick={() => setInviteModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-700 p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleInvite} className="mt-4 space-y-4">
              {adminGroups.length === 0 ? (
                <div className="text-xs text-[#64748B] leading-relaxed space-y-3">
                  <p>Invitations are sent through a group. Create a group first, then invite teammates to it.</p>
                  <button
                    type="button"
                    onClick={() => { setInviteModalOpen(false); navigate('/groups'); }}
                    className="px-4 py-1.5 rounded-lg bg-zinc-900 hover:bg-black text-white text-xs font-semibold"
                  >
                    Go to Groups
                  </button>
                </div>
              ) : (
              <>
              <p className="text-xs text-[#64748B] leading-relaxed">
                We email them the invitation, and they join the group only after they accept. Then share projects with the group to work together.
              </p>

              <div>
                <label className="block text-xs font-semibold text-[#111827] mb-1.5">Group</label>
                <select
                  value={inviteGroupId}
                  onChange={(e) => setInviteGroupId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#E2E5E8] bg-white focus:outline-none focus:border-[#52525B]"
                >
                  {adminGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#111827] mb-1.5">
                  Teammate Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="alex@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#E2E5E8] focus:outline-none focus:border-[#52525B] focus:ring-2 focus:ring-zinc-100"
                />
              </div>

              {inviteError && <p role="alert" className="text-xs text-red-600">{inviteError}</p>}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setInviteModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-[#E2E5E8] text-xs font-medium text-zinc-600 hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviteBusy}
                  className="px-4 py-1.5 rounded-lg bg-zinc-900 hover:bg-black text-white text-xs font-semibold shadow-xs transition-colors disabled:opacity-60"
                >
                  {invited ? 'Invite Sent!' : inviteBusy ? 'Sending...' : 'Send Invite'}
                </button>
              </div>
              </>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
