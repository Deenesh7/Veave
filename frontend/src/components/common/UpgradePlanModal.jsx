import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Shown whenever the API refuses an action because a plan limit (projects, storage, credits, tokens) was reached.
export default function UpgradePlanModal() {
  const [message, setMessage] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onLimit = (event) => setMessage(event.detail?.message || 'You have reached your plan limit.');
    window.addEventListener('veave:plan-limit', onLimit);
    return () => window.removeEventListener('veave:plan-limit', onLimit);
  }, []);

  if (!message) return null;
  const close = () => setMessage(null);
  return (
    <div role="dialog" aria-modal="true" onClick={close}
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: '#16161a', color: '#fff', borderRadius: 12, padding: 24, maxWidth: 420, width: '100%', border: '1px solid rgba(255,255,255,0.1)' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Plan limit reached</h2>
        <p style={{ margin: '12px 0 20px', fontSize: 14, lineHeight: 1.5, opacity: 0.8 }}>{message}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={close} style={{ padding: '8px 14px', borderRadius: 8, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer' }}>Not now</button>
          <button onClick={() => { close(); navigate('/billing'); }} style={{ padding: '8px 14px', borderRadius: 8, background: '#7c5cff', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Upgrade plan</button>
        </div>
      </div>
    </div>
  );
}
