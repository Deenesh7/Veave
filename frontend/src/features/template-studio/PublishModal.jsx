import React from 'react';
import { Modal, ink, muted } from './ui';
import { PublishPanel } from '../share/PublishPanel';

/**
 * Publishes the website to the platform's hosting: a free address (name.<base domain>) and, if the owner types one, their own domain
 * (the server publishes, checks the domain, sets up DNS and HTTPS and shows the progress). It is the same publishing the rest of the
 * app uses, so a website published here appears there too.
 */
export default function PublishModal({ site, working, onClose }) {
  return (
    <Modal open onClose={onClose} title={`Publish \u00b7 ${site.name}`} wide>
      <div className="space-y-3">
        <p className={`text-xs leading-relaxed ${muted}`}>
          The website is published exactly as it is saved now. Publish the website, and switch on Custom domain to also use an address you own.
        </p>
        {working ? (
          <p role="status" className="rounded-md border border-[#E7D6A9] bg-[#FBF1DC] px-3 py-2 text-xs text-[#7A5A1E]">The AI is still working on a page. Wait for it to finish so the new version is what gets published.</p>
        ) : null}
        <div className={ink}>
          <PublishPanel project={{ id: site.projectId, name: site.name }} />
        </div>
      </div>
    </Modal>
  );
}
