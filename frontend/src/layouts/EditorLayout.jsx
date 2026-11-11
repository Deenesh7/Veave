import { Outlet } from 'react-router-dom';
import PersistentGenerationIndicator from '../components/dashboard/PersistentGenerationIndicator';
import SharedProjectBanner from '../features/collaboration/SharedProjectBanner';

export default function EditorLayout() {
  return (
    <div className="h-screen w-screen overflow-hidden canvas-grid-pattern bg-[#F7F4EE] flex flex-col">
      <Outlet />
      <PersistentGenerationIndicator />
      <SharedProjectBanner />
    </div>
  );
}
