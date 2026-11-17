import React, { useState } from 'react';
import { Activity, AlertTriangle, CalendarPlus, Coins, Flame, Globe2, LayoutTemplate, Library, UserCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { adminService, adminError } from '../../services/adminService';
import { Async, Btn, Card, Page, Select, Stat, useAsync, fmt } from './ui';
import { BarChart, LineChart, RankedBars } from './charts';

export default function DashboardPage() {
  const [days, setDays] = useState('30');
  const state = useAsync(() => adminService.dashboard({ days }), [days]);
  return (
    <Page title="Dashboard" subtitle="A live overview of users, templates, websites and credits."
      actions={<><Select value={days} onChange={(event) => setDays(event.target.value)} className="w-auto" aria-label="Period"><option value="7">Last 7 days</option><option value="14">Last 14 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></Select><Btn onClick={state.reload} busy={state.loading && Boolean(state.data)}>Refresh</Btn></>}>
      <Async state={state} errorFallback={(error) => adminError(error)} skeleton={<div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">{Array.from({ length: 9 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-[#EFEBE1]" />)}</div>}>
        {({ cards, charts, range }) => (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
              <Stat label="Registered users" value={fmt(cards.totalUsers)} icon={Users} hint={`${fmt(cards.newToday)} new today`} />
              <Stat label="Active users" value={fmt(cards.activeUsers)} icon={UserCheck} hint="Active in the last 30 days" tone="blue" />
              <Stat label="Templates" value={fmt(cards.totalTemplates)} icon={LayoutTemplate} hint={`${fmt(cards.publishedTemplates)} published`} tone="purple" />
              <Stat label="Websites generated" value={fmt(cards.websitesGenerated)} icon={Globe2} tone="green" />
              <Stat label="New registrations today" value={fmt(cards.newToday)} icon={CalendarPlus} tone="amber" />
              <Stat label="Credits distributed" value={fmt(cards.creditsDistributed)} icon={Coins} hint="All credits given or bought" />
              <Stat label="Credits consumed" value={fmt(cards.creditsConsumed)} icon={Flame} hint="Used by generations" tone="red" />
              <Stat label="Low credit balances" value={fmt(cards.lowBalanceUsers)} icon={AlertTriangle} hint={`${cards.lowBalanceThreshold} credits or fewer`} tone="amber" />
              <Stat label="Library templates" value={fmt(cards.publishedTemplates)} icon={Library} hint="Visible in Template Studio" tone="purple" />
              <Stat label="Period" value={<span className="text-xl">{range.from.slice(5)} → {range.to.slice(5)}</span>} icon={Activity} hint="Charts below" tone="blue" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="User growth" action={<span className="text-xs text-[#7A7366]">Total users</span>}><LineChart data={charts.userGrowth} series={[{ key: 'total', label: 'Total users', color: '#2F4A35' }, { key: 'users', label: 'New users', color: '#C08A2B' }]} /></Card>
              <Card title="Daily credit consumption"><LineChart data={charts.dailyCredits} series={[{ key: 'credits', label: 'Credits used', color: '#A4493A' }]} /></Card>
              <Card title="Monthly credit consumption"><BarChart data={charts.monthlyCredits} xKey="month" yKey="credits" color="#A4493A" /></Card>
              <Card title="Website generation activity"><LineChart data={charts.generations} series={[{ key: 'websites', label: 'Websites created', color: '#2F4A35' }, { key: 'completed', label: 'Jobs completed', color: '#2F4E78' }, { key: 'failed', label: 'Jobs failed', color: '#A4493A' }]} /></Card>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="Popular templates" className="lg:col-span-2" action={<Link to="/admin/templates" className="text-xs text-[#2F4A35] underline">Manage</Link>}><RankedBars rows={charts.popularTemplates} labelKey="name" valueKey="websites" suffix=" sites" /></Card>
              <Card title="Quick links"><div className="grid gap-2 text-sm"><Link className="rounded-lg border border-[#E2DCCF] px-3 py-2 hover:bg-[#F5F1E8]" to="/admin/credits">Give or deduct credits</Link><Link className="rounded-lg border border-[#E2DCCF] px-3 py-2 hover:bg-[#F5F1E8]" to="/admin/users">Find a user</Link><Link className="rounded-lg border border-[#E2DCCF] px-3 py-2 hover:bg-[#F5F1E8]" to="/admin/templates">Upload a template</Link><Link className="rounded-lg border border-[#E2DCCF] px-3 py-2 hover:bg-[#F5F1E8]" to="/admin/notifications">Review notifications</Link></div></Card>
            </div>
          </>
        )}
      </Async>
    </Page>
  );
}
