import React, { useState, useEffect } from 'react';
import { X, Sparkles } from 'lucide-react';
import { ShareTabs } from './ShareTabs';
import { ShareLinks } from './ShareLinks';
import { InviteUsers } from './InviteUsers';
import { WorkspaceInvite } from './WorkspaceInvite';
import { AccessSelector } from './AccessSelector';
import { AccessUserList } from './AccessUserList';
import { RemoveAccessDialog } from './RemoveAccessDialog';
import { PublishPanel } from './PublishPanel';
import { useAuthStore } from '../../store/authStore';

export function ShareModal({ isOpen, onClose, project }) {
  const { user: currentUser } = useAuthStore();
  const [activeTab, setActiveTab] = useState('collaborate');
  const [accessLevel, setAccessLevel] = useState('Only those invited');
  
  // Active collaborator users state
  const ownerEmail = currentUser?.email || 'user@example.com';
  const ownerName = currentUser?.name || 'Project Owner';

  const [users, setUsers] = useState([
    {
      id: 'owner-1',
      name: ownerName,
      email: ownerEmail,
      role: 'Owner',
      isYou: true
    }
  ]);

  const [userToRemove, setUserToRemove] = useState(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Handle invitation submission from InviteUsers
  const handleInviteUsers = (newEmails) => {
    const newCollaborators = newEmails.map((email, idx) => ({
      id: `invited-${Date.now()}-${idx}`,
      name: email.split('@')[0],
      email: email,
      role: 'Viewer',
      isYou: false
    }));

    setUsers((prev) => [...prev, ...newCollaborators]);
  };

  // Handle workspace team invitation
  const handleWorkspaceInvite = (workspaceName) => {
    setAccessLevel('Anyone in the workspace');
  };

  // Handle user role change
  const handleRoleChange = (userId, newRole) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
    );
  };

  // Confirm remove access
  const handleConfirmRemove = () => {
    if (!userToRemove) return;
    setUsers((prev) => prev.filter((u) => u.id !== userToRemove.id));
    setUserToRemove(null);
  };

  const projectId = project?._id || project?.id || 'abc123';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      {/* 1. Dark semi-transparent backdrop with slight blur */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* 2. White Rounded Modal Window */}
      <div
        className="relative w-full max-w-[480px] max-h-[90vh] bg-white rounded-2xl border border-[#DDE2E5] shadow-2xl p-6 overflow-y-auto scrollbar-thin z-10 animate-in fade-in zoom-in-95 duration-200 flex flex-col select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header with Close Button */}
        <div className="flex items-center justify-between pb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-[#111827] tracking-tight">
              Share Project
            </h3>
            <span className="text-xs text-zinc-400 font-medium">·</span>
            <span className="text-xs text-zinc-500 font-medium truncate max-w-[160px]">
              {project?.name || 'Veave Project'}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors cursor-pointer"
            title="Close modal (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Top Tabs: Collaborate vs Publish */}
        <ShareTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        {/* Tab Content */}
        {activeTab === 'collaborate' ? (
          <div>
            {/* 1. Share Links (Preview & Editor) */}
            <ShareLinks projectId={projectId} />

            {/* 2. Give Access Input */}
            <InviteUsers onInvite={handleInviteUsers} />

            {/* 3. Highlighted Workspace Invite Row */}
            <WorkspaceInvite
              workspaceName="VEAVE"
              onWorkspaceInvite={handleWorkspaceInvite}
            />

            {/* 4. Who has access level selector */}
            <AccessSelector
              value={accessLevel}
              onChange={setAccessLevel}
            />

            {/* 5. Users with access heading & list */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-[#111827]">
                  Users with access
                </span>
                <span className="text-[10px] font-mono text-zinc-400">
                  {users.length} members
                </span>
              </div>

              <AccessUserList
                users={users}
                onRoleChange={handleRoleChange}
                onRemoveRequest={(u) => setUserToRemove(u)}
              />
            </div>
          </div>
        ) : (
          /* Publish Tab Content */
          <PublishPanel
            project={project}
            onPublishUpdate={(data) => {
              console.log('Project publishing updated:', data);
            }}
          />
        )}
      </div>

      {/* Confirmation Dialog when removing access */}
      <RemoveAccessDialog
        isOpen={!!userToRemove}
        user={userToRemove}
        onConfirm={handleConfirmRemove}
        onCancel={() => setUserToRemove(null)}
      />
    </div>
  );
}

export default ShareModal;
