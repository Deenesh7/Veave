import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useCollabStore } from '../../store/collabStore';
import { useAuthStore } from '../../store/authStore';
import { timeAgo } from './ui';

export function notificationTarget(n) {
  if (n.type === 'group_invitation' && n.data?.invitationId) return '/invitations';
  if (['project_shared', 'project_unshared'].includes(n.type)) return n.data?.projectId && n.type === 'project_shared' ? `/editor/${n.data.projectId}` : '/collab/projects';
  if (n.data?.groupId && !['removed_from_group'].includes(n.type)) return `/groups/${n.data.groupId}`;
  return '/invitations';
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { notifications, unread, fetchNotifications, markAllRead, fetchInvitations } = useCollabStore();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    fetchNotifications();
    fetchInvitations();
    const timer = setInterval(() => { fetchNotifications(); fetchInvitations(); }, 30000);
    return () => clearInterval(timer);
  }, [isAuthenticated, fetchNotifications, fetchInvitations]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!isAuthenticated) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
        className="relative p-2 rounded-lg border border-[#E2E5E8] text-zinc-600 hover:bg-zinc-50 transition-colors"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-white rounded-xl border border-[#E2E5E8] shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-100">
            <span className="text-xs font-bold text-[#111827]">Notifications</span>
            {unread > 0 && <button type="button" onClick={markAllRead} className="text-[11px] text-zinc-500 hover:text-zinc-900">Mark all read</button>}
          </div>
          <ul className="max-h-80 overflow-y-auto divide-y divide-zinc-100">
            {notifications.length === 0 && <li className="px-3 py-6 text-center text-xs text-zinc-500">You are all caught up.</li>}
            {notifications.slice(0, 8).map((n) => (
              <li key={n._id}>
                <button type="button" onClick={() => { setOpen(false); navigate(notificationTarget(n)); }} className="w-full text-left px-3 py-2.5 hover:bg-zinc-50 flex gap-2">
                  <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${n.readAt ? 'bg-transparent' : 'bg-indigo-500'}`} />
                  <span className="min-w-0"><span className="block text-xs font-semibold text-[#111827]">{n.title}</span><span className="block text-[10px] text-zinc-400 mt-0.5">{timeAgo(n.createdAt)}</span></span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => { setOpen(false); navigate('/invitations'); }} className="w-full px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 border-t border-zinc-100">View all & invitations</button>
        </div>
      )}
    </div>
  );
}
