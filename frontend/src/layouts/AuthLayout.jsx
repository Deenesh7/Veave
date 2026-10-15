import { Outlet } from 'react-router-dom';
import { Logo } from '../components/common/Logo';

export default function AuthLayout() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 canvas-grid-pattern relative overflow-hidden">
      {/* Background gradients */}
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent opacity-50" />
      <div className="absolute -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80" aria-hidden="true">
        <div className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-[#ff80b5] to-[#9089fc] opacity-20 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]" />
      </div>
      
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>
        <div className="bg-zinc-50/80 backdrop-blur-sm border border-zinc-200 rounded-2xl p-8 shadow-2xl relative">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
