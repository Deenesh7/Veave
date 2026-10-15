import { Outlet } from 'react-router-dom';
import PersistentGenerationIndicator from '../components/dashboard/PersistentGenerationIndicator';

export default function EditorLayout() {
  return (
    <div className="h-screen w-screen overflow-hidden canvas-grid-pattern flex flex-col">
      <Outlet />
      <PersistentGenerationIndicator />
    </div>
  );
}
