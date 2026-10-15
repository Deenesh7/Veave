import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ArrowLeft } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Textarea } from '../components/ui/Textarea';
import { TemplateSelector } from '../features/projects/TemplateSelector';
import { useProjectStore } from '../store/projectStore';

export default function NewProject() {
  const [prompt, setPrompt] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();
  const { createProject } = useProjectStore();

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsCreating(true);
    try {
      const name = prompt.split(' ').slice(0, 5).join(' ') + '...';
      const project = await createProject({
        name: name,
        description: prompt,
        prompt: prompt
      });
      navigate(`/editor/${project._id}`);
    } catch (err) {
      console.error(err);
      setIsCreating(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <Button 
        variant="ghost" 
        size="sm" 
        icon={ArrowLeft} 
        className="mb-8 text-zinc-400 hover:text-zinc-900 -ml-3"
        onClick={() => navigate('/dashboard')}
      >
        Back to Dashboard
      </Button>

      <div className="mb-10 text-center animate-fade-in">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3 text-zinc-900">
          What do you want to build?
        </h1>
        <p className="text-zinc-400 text-lg">
          Describe your application and AI will generate it for you.
        </p>
      </div>

      <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-6 md:p-8 shadow-2xl animate-slide-up">
        <Textarea
          rows={5}
          placeholder="e.g., Create a modern SaaS analytics dashboard with a sidebar navigation, dark theme, and a main content area showing KPI cards and a revenue chart..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="text-base p-4 mb-6"
          autoFocus
        />

        <div className="flex flex-wrap gap-2 mb-6">
          <span className="text-xs text-zinc-400 py-1 font-medium">Inspirations:</span>
          {[
            'SaaS analytics dashboard with revenue charts & dark sidebar',
            'Minimalist e-commerce product store with slide-over cart',
            'Project task management Kanban board with tag filters',
            'AI prompt playground with temperature sliders & history'
          ].map((idea, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setPrompt(idea)}
              className="text-xs px-2.5 py-1 rounded-lg bg-white border border-zinc-200 hover:border-indigo-400 hover:text-indigo-600 transition-colors text-zinc-600 shadow-2xs"
            >
              {idea.split(' with ')[0]}
            </button>
          ))}
        </div>

        <div className="flex justify-center mb-8">
          <Button 
            size="lg" 
            className="w-full max-w-md h-12 text-base rounded-xl"
            icon={Sparkles}
            onClick={handleGenerate}
            loading={isCreating}
            disabled={!prompt.trim()}
          >
            Generate Application
          </Button>
        </div>

        <div className="pt-6 border-t border-zinc-200">
          <TemplateSelector onSelect={setPrompt} />
        </div>
      </div>
    </div>
  );
}
