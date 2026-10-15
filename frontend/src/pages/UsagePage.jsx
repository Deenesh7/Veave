import { useState, useEffect, useCallback, useMemo } from 'react';
import { Activity, Zap, ArrowDownToLine, ArrowUpFromLine, Clock, BarChart3, RefreshCw, Loader2 } from 'lucide-react';
import api from '../services/api';

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-white rounded-xl border border-[#E2E5E8] p-5 flex items-start gap-4 shadow-sm">
      <div className={`p-2.5 rounded-lg ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-[#111827] mt-1">{typeof value === 'number' ? value.toLocaleString() : value}</p>
      </div>
    </div>
  );
}

export default function UsagePage() {
  const [summary, setSummary] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [sumRes, listRes] = await Promise.all([
        api.get('/usage/summary'),
        api.get('/usage?limit=50')
      ]);
      setSummary(sumRes.data?.data || null);
      setRecords(listRes.data?.data || []);
    } catch (err) {
      console.error('Failed to fetch usage:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const groupedRecords = useMemo(() => {
    const map = new Map();
    
    records.forEach(r => {
      const projId = r.projectId?._id || r.projectId || 'unknown';
      const projName = r.projectId?.name || 'Unknown Project';
      
      if (!map.has(projId)) {
        map.set(projId, {
          id: projId,
          name: projName,
          lastUpdated: r.createdAt,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          requestDuration: 0,
          model: r.model,
          provider: r.provider,
          generationsCount: 0
        });
      }
      
      const entry = map.get(projId);
      entry.inputTokens += (r.inputTokens || 0);
      entry.outputTokens += (r.outputTokens || 0);
      entry.totalTokens += (r.totalTokens || 0);
      entry.requestDuration += (r.requestDuration || 0);
      entry.generationsCount += 1;
      
      if (new Date(r.createdAt) > new Date(entry.lastUpdated)) {
        entry.lastUpdated = r.createdAt;
        entry.model = r.model || entry.model;
        entry.provider = r.provider || entry.provider;
      }
    });
    
    return Array.from(map.values()).sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
  }, [records]);

  const formatDate = (dateStr) => {
    if (!dateStr) return '\u2014';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    });
  };

  const formatDuration = (ms) => {
    if (!ms) return '\u2014';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-black animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#111827] flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-black" />
            Token Usage
          </h1>
          <p className="text-sm text-zinc-500 mt-1">Track your AI token consumption across all generations</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-600 bg-white border border-[#E2E5E8] rounded-lg hover:bg-zinc-50 hover:text-[#111827] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Zap} label="Total Tokens" value={summary?.totalTokens || 0} color="bg-black" />
        <StatCard icon={ArrowUpFromLine} label="Input Tokens" value={summary?.totalInputTokens || 0} color="bg-black" />
        <StatCard icon={ArrowDownToLine} label="Output Tokens" value={summary?.totalOutputTokens || 0} color="bg-black" />
        <StatCard icon={Activity} label="Total Requests" value={summary?.totalRequests || 0} color="bg-black" />
      </div>

      {/* Latest Generation Info */}
      {summary?.latest && (
        <div className="bg-white rounded-xl border border-[#E2E5E8] p-4 shadow-sm">
          <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide mb-2">Latest Generation</p>
          <div className="flex flex-wrap gap-4 text-sm text-[#111827]">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-zinc-400" />
              {formatDate(summary.latest.createdAt)}
            </span>
            <span className="px-2 py-0.5 bg-black text-white rounded-md text-xs font-medium">
              {summary.latest.model || 'Unknown'}
            </span>

            <span className="text-zinc-500">
              {(summary.latest.totalTokens || 0).toLocaleString()} tokens
            </span>
          </div>
        </div>
      )}

      {/* Usage Records Table */}
      <div className="bg-white rounded-xl border border-[#E2E5E8] shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E2E5E8]">
          <h2 className="text-sm font-semibold text-[#111827]">Generation History</h2>
        </div>
        {records.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Activity className="w-10 h-10 text-zinc-300 mx-auto mb-3" />
            <p className="text-sm text-zinc-500">No usage records yet</p>
            <p className="text-xs text-zinc-400 mt-1">Generate a design to see token usage here</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F8F9FA] text-left">
                  <th className="px-5 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Date</th>
                  <th className="px-5 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Project</th>
                  <th className="px-5 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Model</th>

                  <th className="px-5 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide text-right">Input</th>
                  <th className="px-5 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide text-right">Output</th>
                  <th className="px-5 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide text-right">Total</th>
                  <th className="px-5 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide text-right">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E5E8]">
                {groupedRecords.map((r) => (
                  <tr key={r.id} className="hover:bg-[#F8F9FA]/60 transition-colors">
                    <td className="px-5 py-3 text-zinc-600 whitespace-nowrap">{formatDate(r.lastUpdated)}</td>
                    <td className="px-5 py-3 text-[#111827] font-medium">
                      {r.name}
                      {r.generationsCount > 1 && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-100 text-zinc-500">
                          {r.generationsCount} edits
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className="px-2 py-0.5 bg-black text-white rounded-md text-xs font-medium">
                        {r.model || '—'}
                      </span>
                    </td>

                    <td className="px-5 py-3 text-right text-black font-mono text-xs">{(r.inputTokens || 0).toLocaleString()}</td>
                    <td className="px-5 py-3 text-right text-black font-mono text-xs">{(r.outputTokens || 0).toLocaleString()}</td>
                    <td className="px-5 py-3 text-right font-semibold text-black font-mono text-xs">{(r.totalTokens || 0).toLocaleString()}</td>
                    <td className="px-5 py-3 text-right text-zinc-500 font-mono text-xs">{formatDuration(r.requestDuration)}</td>
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
