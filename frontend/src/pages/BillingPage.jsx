import React, { useEffect, useState } from 'react';
import {
  Check,
  Sparkles,
  X,
  Building,
  Loader2,
  CreditCard,
  Zap,
  HardDrive,
  FolderOpen,
  Calendar,
  CheckCircle2,
  ShieldCheck,
  Receipt,
  ExternalLink,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useBillingStore } from '../store/billingStore';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTokens(num) {
  if (!num || num === 0) return '0';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toLocaleString();
}

function ProgressBar({ percentage, color = 'bg-[#252525]' }) {
  return (
    <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden mt-2">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
      />
    </div>
  );
}

function UsageCard({ icon: Icon, label, value, subtext, percentage }) {
  return (
    <div className="bg-white rounded-xl border border-[#E2E5E8] p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-zinc-100">
          <Icon className="w-4 h-4 text-[#111827]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-zinc-500 font-medium uppercase tracking-wide">{label}</p>
          <p className="text-lg font-bold text-[#111827] mt-0.5">{value}</p>
          <p className="text-[11px] text-zinc-400 mt-0.5">{subtext}</p>
          <ProgressBar percentage={percentage} color={percentage > 80 ? 'bg-red-500' : 'bg-[#252525]'} />
        </div>
      </div>
    </div>
  );
}

export default function BillingPage() {
  const { user, fetchProfile } = useAuthStore();
  const {
    overview,
    invoices,
    isLoading,
    isChangingPlan,
    isProcessingPayment,
    paymentSuccess,
    error,
    fetchOverview,
    refreshOverview,
    lastUpdated,
    fetchInvoices,
    changePlan,
    startCheckout,
    clearPaymentSuccess,
    clearError,
  } = useBillingStore();

  const [activeActionPlan, setActiveActionPlan] = useState(null);

  useEffect(() => {
    // Billing is private: without a token every request would 401, so send the user to log in instead.
    if (!localStorage.getItem('veave_token')) {
      window.location.replace(`/login?redirect=${encodeURIComponent('/billing')}`);
      return;
    }
    if (!user && fetchProfile) {
      fetchProfile();
    }
    fetchOverview();
    fetchInvoices();
  }, []);

  // Usage is live: re-read it every few seconds while this page is visible, and immediately when the tab
  // regains focus, so Projects / Storage / Credits / Tokens grow as work happens (no stale snapshot).
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') refreshOverview();
    };
    const interval = setInterval(refresh, 8000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refreshOverview]);

  const handlePlanAction = async (plan) => {
    if (isChangingPlan || isProcessingPayment) return;
    setActiveActionPlan(plan.name);

    try {
      if (plan.isEnterprise) {
        window.location.href = 'mailto:sales@veave.ai?subject=Enterprise%20Plan%20Inquiry';
        return;
      }

      if (plan.name === 'Free Tier') {
        await changePlan('Free Tier');
      } else {
        // Paid plans go through the secure payment checkout
        await startCheckout(plan.name);
      }
    } catch {
      // Error handled by store
    } finally {
      setActiveActionPlan(null);
    }
  };

  const currentPlan = overview?.plan?.name || user?.plan || 'Free Tier';

  const plans = [
    {
      name: 'Free Tier',
      price: '₹0',
      period: 'Free forever',
      description: 'Essential tools to get started.',
      features: [
        { text: '50 Included Credits', type: 'check' },
        { text: '1,000,000 Monthly Tokens', type: 'check' },
        { text: '5 GB File Storage', type: 'check' },
        { text: '5 Projects total limit', type: 'check' },
        { text: 'Unlimited Static Pages', type: 'check' },
        { text: 'Standard Components', type: 'check' },
        { text: 'Custom Domains', type: 'cross' },
        { text: 'Veave watermark included', type: 'cross' },
      ],
      isFree: true,
    },
    {
      name: 'Plus Plan',
      price: '₹2999',
      period: 'per month',
      description: 'For creators & scaling websites.',
      features: [
        { text: '250 Included Credits', type: 'check' },
        { text: '5,000,000 Monthly Tokens', type: 'check' },
        { text: '50 GB File Storage', type: 'check' },
        { text: '15 Projects total limit', type: 'check' },
        { text: 'Buy Extra Credits @ ₹12 / credit', type: 'check' },
        { text: 'Connect Custom Domains', type: 'check' },
        { text: '1 Active Custom Domain', type: 'check' },
        { text: 'No watermark', type: 'check' },
      ],
      amount: '₹2,999',
    },
    {
      name: 'Pro Plan',
      badge: 'MOST POPULAR',
      price: '₹5999',
      period: 'per month',
      description: 'For businesses & professionals.',
      features: [
        { text: '750 Included Credits', type: 'check' },
        { text: '15,000,000 Monthly Tokens', type: 'check' },
        { text: '100 GB File Storage', type: 'check' },
        { text: '100 Projects total limit', type: 'check' },
        { text: 'Buy Extra Credits @ ₹12 / credit', type: 'check' },
        { text: '3 Active Custom Domains', type: 'check' },
        { text: 'Unlimited Team Members', type: 'check' },
        { text: 'Connect Custom Domains', type: 'check' },
        { text: 'No watermark', type: 'check' },
      ],
      amount: '₹5,999',
    },
    {
      name: 'Enterprise',
      badge: 'ENTERPRISE',
      price: 'Custom',
      period: 'Billed after usage • Invoiced',
      description: 'Enterprise plan with post-paid billing.',
      features: [
        { text: 'Post-paid billing & custom limits', type: 'check' },
        { text: 'Pay after usage with monthly invoice', type: 'check' },
        { text: 'Consolidated team management', type: 'check' },
        { text: 'Unlimited Custom Domains', type: 'check' },
        { text: 'Dedicated account manager & SLA', type: 'check' },
        { text: 'No watermark & priority queues', type: 'check' },
      ],
      isEnterprise: true,
    },
  ];

  const getButtonProps = (plan) => {
    const isActive = plan.name === currentPlan;
    const isWorking = activeActionPlan === plan.name;

    if (plan.isEnterprise) {
      return {
        label: 'Contact Sales',
        style: 'black',
        disabled: false,
        onClick: () => handlePlanAction(plan),
      };
    }

    if (isActive) {
      return {
        label: 'Active Plan',
        style: 'gray',
        disabled: true,
        onClick: () => {},
      };
    }

    if (plan.isFree) {
      return {
        label: 'Downgrade to Free',
        style: 'outline',
        disabled: isWorking || isChangingPlan || isProcessingPayment,
        onClick: () => handlePlanAction(plan),
      };
    }

    return {
      label: `Upgrade for ${plan.amount}`,
      style: 'pay',
      disabled: isWorking || isChangingPlan || isProcessingPayment,
      onClick: () => handlePlanAction(plan),
    };
  };

  if (isLoading && !overview) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-black animate-spin" />
      </div>
    );
  }

  const renewsAt = overview?.renewsAt
    ? new Date(overview.renewsAt).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    <div className="w-full py-10 px-4 max-w-6xl mx-auto space-y-10">
      {/* Header */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-50 border border-zinc-200 text-[11px] font-bold text-[#111827] mx-auto shadow-2xs">
          <Sparkles className="w-3.5 h-3.5" />
          Workspace Plan & Billing
        </div>
        <h1 className="text-3xl font-extrabold text-[#111827] tracking-tight">
          Upgrade {user?.name ? `${user.name}'s Workspace` : 'your workspace'}
        </h1>
        <p className="text-sm text-zinc-500 max-w-lg mx-auto leading-relaxed">
          Select a plan below to scale your credits, storage, and monthly token quota. Secure checkout.
        </p>
      </div>

      {/* Success Notification Banner */}
      {paymentSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3.5 rounded-xl text-sm flex items-start justify-between shadow-xs">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-bold text-emerald-900">Payment Successful! Upgraded to {paymentSuccess.plan}</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                {paymentSuccess.invoice?.invoiceNumber
                  ? `Invoice #${paymentSuccess.invoice.invoiceNumber} has been generated. Your limits have been updated.`
                  : 'Your workspace limits and credits have been updated.'}
              </p>
            </div>
          </div>
          <button
            onClick={clearPaymentSuccess}
            className="text-emerald-500 hover:text-emerald-800 p-1 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center justify-between shadow-xs">
          <span>{error}</span>
          <button onClick={clearError} className="text-red-400 hover:text-red-600 ml-2">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Current Plan Overview */}
      {overview && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#111827] flex items-center gap-2">
                <CreditCard className="w-5 h-5" />
                Current Plan: <span className="text-[#252525]">{currentPlan}</span>
              </h2>
              {renewsAt && (
                <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1.5">
                  <Calendar className="w-3 h-3" />
                  Renews on {renewsAt}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 font-medium" title={lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString()}` : ''}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live usage
              </span>
              <span className="flex items-center gap-1 text-[11px] text-zinc-500 font-medium">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Secure Checkout
              </span>
              <div className="px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold uppercase tracking-wide">
                {overview.plan?.status || 'Active'}
              </div>
            </div>
          </div>

          {/* Usage Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <UsageCard
              icon={Sparkles}
              label="Credits"
              value={`${overview.credits?.remaining ?? 0} / ${overview.credits?.allocated ?? 0}`}
              subtext={`${overview.credits?.used ?? 0} used`}
              percentage={overview.credits?.percentage ?? 0}
            />
            <UsageCard
              icon={Zap}
              label="Tokens This Month"
              value={`${formatTokens(overview.tokens?.used ?? 0)} / ${formatTokens(overview.tokens?.limit ?? 0)}`}
              subtext={`${overview.tokens?.requests ?? 0} requests`}
              percentage={overview.tokens?.percentage ?? 0}
            />
            <UsageCard
              icon={HardDrive}
              label="Storage"
              value={`${formatBytes(overview.storage?.usedBytes ?? 0)} / ${formatBytes(overview.storage?.limitBytes ?? 0)}`}
              subtext={`${overview.storage?.percentage ?? 0}% used`}
              percentage={overview.storage?.percentage ?? 0}
            />
            <UsageCard
              icon={FolderOpen}
              label="Projects"
              value={`${overview.projects?.count ?? 0} / ${overview.projects?.limit ?? 0}`}
              subtext={`${Math.max(0, (overview.projects?.limit ?? 0) - (overview.projects?.count ?? 0))} remaining`}
              percentage={overview.projects?.percentage ?? 0}
            />
          </div>
        </div>
      )}

      {/* Plan Cards */}
      <div className="grid lg:grid-cols-4 gap-4">
        {plans.map((p, idx) => {
          const btn = getButtonProps(p);
          const isActive = p.name === currentPlan;
          const isWorking = activeActionPlan === p.name;

          return (
            <div
              key={idx}
              className={`rounded-2xl border p-6 flex flex-col transition-all bg-white relative ${
                p.badge === 'MOST POPULAR'
                  ? 'border-zinc-800 shadow-xl border-2'
                  : isActive
                  ? 'border-emerald-300 shadow-md border-2'
                  : 'border-zinc-200 shadow-sm'
              }`}
            >
              {p.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1e2023] text-white text-[9px] font-extrabold uppercase tracking-widest shadow-md">
                  {p.badge === 'ENTERPRISE' && <Building className="w-3 h-3" />}
                  {p.badge}
                </div>
              )}

              {isActive && !p.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-600 text-white text-[9px] font-extrabold uppercase tracking-widest shadow-md">
                  CURRENT PLAN
                </div>
              )}

              <div className="mb-6 flex-1">
                <h3 className="text-[17px] font-bold text-[#111827] leading-tight mb-1.5">{p.name}</h3>
                <p className="text-xs text-zinc-500 leading-relaxed mb-6">
                  {p.description}
                </p>

                <div className="flex flex-col mb-8">
                  <span className="text-3xl font-black text-[#111827] tracking-tight">{p.price}</span>
                  <span className="text-[11px] text-zinc-500 font-medium mt-1">{p.period}</span>
                </div>

                <div className="space-y-3.5 pt-6 border-t border-zinc-100">
                  {p.features.map((f, fi) => (
                    <div key={fi} className="flex items-start gap-2.5 text-xs text-zinc-600">
                      {f.type === 'check' ? (
                        <Check className="w-3.5 h-3.5 text-[#111827] shrink-0 mt-0.5 font-bold" />
                      ) : (
                        <X className="w-3 h-3 text-zinc-400 shrink-0 mt-0.5" />
                      )}
                      <span>{f.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="button"
                disabled={btn.disabled}
                onClick={btn.onClick}
                className={`w-full py-2.5 px-3 rounded-lg text-xs font-bold transition-all mt-4 flex items-center justify-center gap-2 ${
                  btn.style === 'outline'
                    ? 'bg-white border border-zinc-200 text-[#111827] hover:bg-zinc-50 cursor-pointer'
                    : btn.style === 'gray'
                    ? 'bg-[#8F9499] text-white cursor-default opacity-90'
                    : btn.style === 'pay'
                    ? 'bg-[#0F172A] hover:bg-black text-white cursor-pointer shadow-sm'
                    : 'bg-[#252525] hover:bg-black text-white cursor-pointer shadow-xs'
                } ${btn.disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {isWorking && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {btn.label}
              </button>
            </div>
          );
        })}
      </div>

      {/* Trust & Security Note */}
      <div className="flex flex-wrap items-center justify-center gap-6 py-4 px-6 rounded-xl bg-zinc-50 border border-zinc-200 text-xs text-zinc-500">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>256-bit SSL encrypted payments</span>
        </div>
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-zinc-700" />
          <span>Supports UPI, Debit/Credit Cards, Net Banking & Wallets</span>
        </div>
      </div>

      {/* Billing & Invoice History */}
      <div className="bg-white rounded-2xl border border-[#E2E5E8] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2E5E8] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-zinc-700" />
            <h2 className="text-sm font-bold text-[#111827]">Invoices & Payment History</h2>
          </div>
          <span className="text-xs text-zinc-400 font-medium">
            {invoices.length} {invoices.length === 1 ? 'transaction' : 'transactions'}
          </span>
        </div>

        {invoices.length === 0 ? (
          <div className="py-12 text-center">
            <Receipt className="w-9 h-9 text-zinc-300 mx-auto mb-2" />
            <p className="text-sm text-zinc-500 font-medium">No past invoices yet</p>
            <p className="text-xs text-zinc-400 mt-0.5">When you upgrade, your receipts will appear here</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-zinc-50 text-left border-b border-zinc-100">
                  <th className="px-6 py-3 font-semibold text-zinc-500 uppercase tracking-wide">Date</th>
                  <th className="px-6 py-3 font-semibold text-zinc-500 uppercase tracking-wide">Invoice #</th>
                  <th className="px-6 py-3 font-semibold text-zinc-500 uppercase tracking-wide">Plan</th>
                  <th className="px-6 py-3 font-semibold text-zinc-500 uppercase tracking-wide">Payment ID</th>
                  <th className="px-6 py-3 font-semibold text-zinc-500 uppercase tracking-wide text-right">Amount</th>
                  <th className="px-6 py-3 font-semibold text-zinc-500 uppercase tracking-wide text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-zinc-50/70 transition-colors">
                    <td className="px-6 py-3.5 text-zinc-600 font-medium">
                      {new Date(inv.date).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-6 py-3.5 font-mono text-zinc-900 font-bold">
                      {inv.invoiceNumber}
                    </td>
                    <td className="px-6 py-3.5 text-zinc-800 font-semibold">{inv.plan}</td>
                    <td className="px-6 py-3.5 font-mono text-zinc-500">{inv.paymentId || '—'}</td>
                    <td className="px-6 py-3.5 text-right font-bold text-zinc-900 font-mono">
                      ₹{Number(inv.amount).toLocaleString('en-IN')}
                    </td>
                    <td className="px-6 py-3.5 text-center">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wider border border-emerald-200">
                        <Check className="w-2.5 h-2.5" />
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
