import { useCallback, useEffect, useRef, useState } from 'react';
import { hostingService, hostingErrorMessage } from '../../services/hostingService';

const POLL_MS = 1500;

/**
 * Publishing state for one project: current site, latest deployment (with live stage), and actions.
 * Deployments run on the server; this only polls their status, so the UI stays responsive during builds.
 */
export function usePublishing(projectId, { enabled = true } = {}) {
  // Without a login every call would 401, so stay idle until the user is authenticated.
  const activeProjectId = enabled ? projectId : null;
  const [site, setSite] = useState(null);
  const [deployment, setDeployment] = useState(null);
  const [loading, setLoading] = useState(Boolean(activeProjectId));
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const alive = useRef(true);

  const stopPolling = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const refresh = useCallback(async () => {
    if (!activeProjectId) return null;
    const res = await hostingService.getStatus(activeProjectId);
    const data = res.data?.data || {};
    if (!alive.current) return data;
    setSite(data.site || null);
    setDeployment(data.deployment || null);
    return data;
  }, [activeProjectId]);

  const poll = useCallback((deploymentId) => {
    stopPolling();
    const tick = async () => {
      try {
        const res = await hostingService.getDeployment(deploymentId);
        const next = res.data?.data;
        if (!alive.current) return;
        setDeployment(next);
        if (next?.status === 'running') {
          timer.current = setTimeout(tick, POLL_MS);
        } else {
          await refresh();
        }
      } catch (error) {
        if (!alive.current) return;
        setActionError(hostingErrorMessage(error, 'Lost contact with the server while checking the deployment.'));
      }
    };
    timer.current = setTimeout(tick, POLL_MS / 3);
  }, [refresh, stopPolling]);

  useEffect(() => {
    alive.current = true;
    setSite(null);
    setDeployment(null);
    setActionError('');
    if (!activeProjectId) { setLoading(false); return undefined; }
    setLoading(true);
    refresh()
      .then((data) => { if (data?.deployment?.status === 'running') poll(data.deployment.id); })
      .catch((error) => { if (alive.current) setActionError(hostingErrorMessage(error)); })
      .finally(() => { if (alive.current) setLoading(false); });
    return () => { alive.current = false; stopPolling(); };
  }, [activeProjectId, refresh, poll, stopPolling]);

  const publish = useCallback(async (slug, options = {}) => {
    setBusy(true);
    setActionError('');
    try {
      const res = await hostingService.publish(activeProjectId, slug, options);
      const next = res.data?.data?.deployment;
      setDeployment(next);
      poll(next.id);
      return next;
    } catch (error) {
      setActionError(hostingErrorMessage(error));
      return null;
    } finally {
      setBusy(false);
    }
  }, [activeProjectId, poll]);

  const unpublish = useCallback(async () => {
    setBusy(true);
    setActionError('');
    try {
      await hostingService.unpublish(activeProjectId);
      setDeployment(null);
      await refresh();
      return true;
    } catch (error) {
      setActionError(hostingErrorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  }, [activeProjectId, refresh]);

  const isPublishing = deployment?.status === 'running';
  return { site, deployment, loading, busy, isPublishing, actionError, publish, unpublish, refresh };
}

export default usePublishing;
