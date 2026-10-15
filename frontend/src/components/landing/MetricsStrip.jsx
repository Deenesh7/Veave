import React from 'react';

export default function MetricsStrip() {
  const metrics = [
    { value: '10x', label: 'Faster time to MVP', subtext: 'Accelerate cycle time from days to minutes' },
    { value: '< 30s', label: 'Generation velocity', subtext: 'Full multi-component interfaces compiled live' },
    { value: '100%', label: 'Clean React code', subtext: 'Tailwind CSS, standard ES6, zero lock-in' },
    { value: '99.9%', label: 'Uptime & Reliability', subtext: 'Enterprise-grade hosting and API stability' },
  ];

  return (
    <div className="w-full bg-[#F8F9FA] border-y border-[#DDE2E5] py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
          {metrics.map((metric, idx) => (
            <div 
              key={idx} 
              className="flex flex-col items-center text-center p-4 bg-white rounded-2xl border border-[#DDE2E5] shadow-xs hover:shadow-md transition-shadow"
            >
              <span className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-zinc-900 tracking-tight font-mono mb-2">
                {metric.value}
              </span>
              <span className="text-sm font-bold text-zinc-900 mb-1">
                {metric.label}
              </span>
              <span className="text-xs text-zinc-400 leading-normal max-w-[200px]">
                {metric.subtext}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
