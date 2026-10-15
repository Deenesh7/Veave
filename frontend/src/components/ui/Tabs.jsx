import { cn } from '../../utils/helpers';

export function Tabs({ tabs, activeTab, onChange, className }) {
  return (
    <div className={cn('flex flex-row gap-1 bg-zinc-50 p-1 rounded-lg inline-flex', className)}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const Icon = tab.icon;
        
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              'px-3 py-1.5 text-sm rounded-md transition-all flex items-center gap-1.5 font-medium',
              isActive
                ? 'bg-zinc-200 text-zinc-900 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/50'
            )}
          >
            {Icon && <Icon className="w-4 h-4" />}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
