import { ProjectCard } from './ProjectCard';

export function ProjectGrid({ projects, onDelete }) {
  if (!projects || projects.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
      {projects.map((project) => (
        <ProjectCard 
          key={project._id} 
          project={project} 
          onDelete={onDelete} 
        />
      ))}
    </div>
  );
}
