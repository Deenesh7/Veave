import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Bell, Check, X, Clock } from 'lucide-react';
import { useCollabStore } from '../store/collabStore';
import { useAuthStore } from '../store/authStore';
import { apiErrorMessage } from '../services/collaborationService';
import { PageHeader, Btn, Card, EmptyState, Spinner, Notice, StatusBadge, useFlash, timeAgo } from '../features/collaboration/ui';
import { notificationTarget } from '../features/collaboration/NotificationBell';

export default function InvitationsPage() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { invitations, invitationsLoading, fetchInvitations, respondToInvitation, notifications, unread, fetchNotifications, markAllRead } = useCollabStore();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useFlash();

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchInvitations();
    fetchNotifications();
  }, [isAuthenticated, fetchInvitations, fetchNotifications]);

  if (!isAuthenticated) {
    return <EmptyState icon={Mail} title="Log in to see your invitations" action={<Btn onClick={() => navigate('/login?redirect=/invitations')}>Log in</Btn>} />;
  }

  const respond = async (invitation, accept) => {
    setBusyId(invitation.invitationId);
    setError(null);
    try {
      const result = await respondToInvitation(invitation.invitationId, accept);
      if (!accept) setFlash(`You declined the invitation to ${invitation.groupName}.`);
      else if (result.membershipStatus === 'pending') setFlash(`You accepted. An admin of ${invitation.groupName} still needs to approve you.`);
      else { setFlash(`You joined ${invitation.groupName}.`); }
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not answer the invitation.'));
      fetchInvitations(); // the invitation may have been revoked or expired meanwhile
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader title="Invitations & notifications" subtitle="Accept an invitation to join a group. You only get access after you accept." />
      {error && <div className="mb-3"><Notice onClose={() => setError(null)}>{error}</Notice></div>}
      {flash && <div className="mb-3"><Notice kind="success">{flash}</Notice></div>}

      <section aria-label="Pending invitations" className="mb-8">
        <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-500 mb-2">Pending invitations</h2>
        {invitationsLoading && invitations.length === 0 ? <Spinner /> : invitations.length === 0 ? (
          <EmptyState icon={Mail} title="No pending invitations" text="When someone invites you to a group it shows up here and in your notifications." />
        ) : (
          <div className="space-y-3">
            {invitations.map((inv) => (
              <Card key={inv.invitationId} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-[#111827]">{inv.groupName}</h3>
                  {inv.groupDescription && <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{inv.groupDescription}</p>}
                  <p className="text-[11px] text-zinc-500 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>Invited by <b className="text-zinc-700">{inv.inviter?.name}</b></span>
                    <span>{new Date(inv.createdAt).toLocaleDateString()} ({timeAgo(inv.createdAt)})</span>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />expires {new Date(inv.expiresAt).toLocaleDateString()}</span>
                    <span>as {inv.role}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={inv.status} />
                  <Btn icon={Check} loading={busyId === inv.invitationId} onClick={() => respond(inv, true)}>Accept</Btn>
                  <Btn variant="outline" icon={X} disabled={busyId === inv.invitationId} onClick={() => respond(inv, false)}>Decline</Btn>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Notifications">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-500">Notifications{unread ? ` (${unread} new)` : ''}</h2>
          {unread > 0 && <Btn variant="ghost" onClick={markAllRead}>Mark all as read</Btn>}
        </div>
        {notifications.length === 0 ? <EmptyState icon={Bell} title="No notifications yet" /> : (
          <Card>
            <ul className="divide-y divide-zinc-100">
              {notifications.map((n) => (
                <li key={n._id}>
                  <button type="button" onClick={() => navigate(notificationTarget(n))} className="w-full text-left px-4 py-3 hover:bg-zinc-50 flex items-start gap-3">
                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.readAt ? 'bg-transparent' : 'bg-indigo-500'}`} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[#111827]">{n.title}</span>
                      {n.message && <span className="block text-xs text-zinc-500 mt-0.5">{n.message}</span>}
                      <span className="block text-[10px] text-zinc-400 mt-1">{timeAgo(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
