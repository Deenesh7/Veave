import { Check, X, Loader2, ListChecks } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { Button } from '../../components/ui/Button';

/** Live progress of the planner/builder agents. */
export function AgentProgress() {
  const progress = useAgentStore((s) => s.progress);
  if (!progress.length) return null;
  return (
    <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-3 space-y-1.5">
      {progress.map((step) => (
        <div key={step.id} className="flex items-center gap-2 text-xs text-zinc-700">
          {step.status === 'done' ? (
            <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          ) : (
            <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin shrink-0" />
          )}
          <span>{step.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Asks the user to approve or cancel the planner agent's plan. */
export function PlanApprovalCard() {
  const pending = useAgentStore((s) => s.pendingApproval);
  const decidePlan = useAgentStore((s) => s.decidePlan);
  if (!pending) return null;
  const plan = pending.plan || {};

  return (
    <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
      <div className="flex items-center gap-2 mb-2">
        <ListChecks className="w-4 h-4 text-indigo-500" />
        <span className="text-sm font-semibold text-zinc-800">Review the plan</span>
      </div>
      {plan.summary && <p className="text-xs text-zinc-600 mb-3">{plan.summary}</p>}

      {plan.pages?.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Pages</p>
          <div className="flex flex-wrap gap-1">
            {plan.pages.map((p, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-zinc-200 text-zinc-600">
                {p.title || p.path}
              </span>
            ))}
          </div>
        </div>
      )}

      {plan.tasks?.length > 0 && (
        <ol className="mb-3 space-y-1.5 list-decimal list-inside">
          {plan.tasks.map((t) => (
            <li key={t.id} className="text-xs text-zinc-700">
              <span className="font-medium">{t.title}</span>
              {t.description && <span className="text-zinc-500">: {t.description}</span>}
            </li>
          ))}
        </ol>
      )}

      <p className="text-xs font-medium text-zinc-800 mb-2">
        {pending.question || 'Do you want to start building this plan?'}
      </p>
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={() => decidePlan('approve')}>
          <Check className="w-3.5 h-3.5 mr-1" /> Approve
        </Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={() => decidePlan('cancel')}>
          <X className="w-3.5 h-3.5 mr-1" /> Cancel
        </Button>
      </div>
    </div>
  );
}
