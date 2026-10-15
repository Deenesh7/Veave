import { useState } from 'react';
import { TEMPLATE_PROJECTS } from '../../utils/constants';
import { cn } from '../../utils/helpers';
import * as Icons from 'lucide-react';

export function TemplateSelector({ onSelect }) {
  const [selectedId, setSelectedId] = useState(null);

  const handleSelect = (template) => {
    setSelectedId(template.id);
    onSelect(template.prompt);
  };

  return (
    <div className="w-full">
      <h3 className="text-sm font-medium text-zinc-400 mb-3">Or start from a template</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {TEMPLATE_PROJECTS.map((template) => {
          const Icon = Icons[template.icon] || Icons.LayoutTemplate;
          const isSelected = selectedId === template.id;

          return (
            <div
              key={template.id}
              onClick={() => handleSelect(template)}
              className={cn(
                'bg-zinc-50 border rounded-xl p-4 cursor-pointer transition-all duration-200',
                isSelected 
                  ? 'border-indigo-500 bg-indigo-500/5 shadow-[0_0_0_1px_rgba(99,102,241,1)]' 
                  : 'border-zinc-200 hover:border-zinc-600'
              )}
            >
              <Icon className="w-6 h-6 text-indigo-400 mb-2" />
              <h4 className="text-sm font-medium text-zinc-800">{template.name}</h4>
              <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{template.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
