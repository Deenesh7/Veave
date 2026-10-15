import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MatrixOrb } from '../rare-ui';

export function CanvasLoadingOverlay({
  isVisible = true,
  title = 'Loading canvas...',
  subtitle = 'Connecting design canvas & real-time DOM inspector',
  size = 'md',
  className = '',
}) {
  // Size variant styling configurations
  const sizeConfig = {
    lg: {
      orbSize: 80,
      containerSize: 'w-22 h-22 mb-3',
      titleClass: 'text-sm sm:text-base font-bold',
      subtitleClass: 'text-xs text-zinc-500 font-medium mb-3',
      progressClass: 'w-44 h-1.5',
      dotSize: 'w-1.5 h-1.5',
    },
    md: {
      orbSize: 56,
      containerSize: 'w-18 h-18 mb-2.5',
      titleClass: 'text-xs sm:text-sm font-bold',
      subtitleClass: 'text-[11px] text-zinc-500 font-medium mb-2',
      progressClass: 'w-36 h-1',
      dotSize: 'w-1.5 h-1.5',
    },
    sm: {
      orbSize: 40,
      containerSize: 'w-12 h-12 mb-1.5',
      titleClass: 'text-[11px] font-bold',
      subtitleClass: 'text-[10px] text-zinc-500 font-medium mb-1.5',
      progressClass: 'w-24 h-1',
      dotSize: 'w-1 h-1',
    },
  };

  const config = sizeConfig[size] || sizeConfig.md;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.99, transition: { duration: 0.18, ease: 'easeOut' } }}
          className={`absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/90 backdrop-blur-md select-none font-sans overflow-hidden ${className}`}
        >
          {/* Subtle Ambient Light Spotlights */}
          <div className="absolute w-56 h-56 bg-zinc-500/10 rounded-full blur-3xl pointer-events-none -top-10 -left-10 animate-pulse" />
          <div className="absolute w-56 h-56 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none -bottom-10 -right-10 animate-pulse" style={{ animationDelay: '1s' }} />

          {/* Animated Center Stage with Matrix Orb */}
          <div className="relative z-10 flex flex-col items-center justify-center text-center px-4 max-w-sm">
            {/* Pulsing Matrix Orb with Glowing Ambient Rings */}
            <div className={`relative flex items-center justify-center ${config.containerSize}`}>
              <div className="absolute inset-0 rounded-full border border-zinc-400/25 animate-ping opacity-25" />
              <div className="absolute -inset-1.5 rounded-full border border-zinc-500/20 animate-pulse" />

              {/* Interactive Matrix Orb */}
              <div className="relative flex items-center justify-center drop-shadow-[0_0_20px_rgba(37,99,235,0.4)]">
                <MatrixOrb state="thinking" size={config.orbSize} dots={9} color="#18181B" />
              </div>
            </div>

            {/* Title with bouncing indicator dots */}
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`${config.titleClass} tracking-tight text-zinc-900`}>
                {title}
              </span>
              <span className="flex gap-1 items-center ml-0.5">
                <span className={`${config.dotSize} rounded-full bg-zinc-600 animate-bounce`} style={{ animationDelay: '0ms' }} />
                <span className={`${config.dotSize} rounded-full bg-zinc-600 animate-bounce`} style={{ animationDelay: '150ms' }} />
                <span className={`${config.dotSize} rounded-full bg-zinc-600 animate-bounce`} style={{ animationDelay: '300ms' }} />
              </span>
            </div>

            {/* Subtitle context */}
            {subtitle && (
              <p className={`${config.subtitleClass} leading-tight truncate max-w-[280px]`}>
                {subtitle}
              </p>
            )}

            {/* Sleek Gradient Shimmer Progress Line */}
            <div className={`${config.progressClass} bg-zinc-200/80 rounded-full overflow-hidden relative shadow-inner mt-0.5`}>
              <motion.div
                className="absolute inset-y-0 w-16 bg-gradient-to-r from-zinc-600/20 via-zinc-600 to-indigo-600/20 rounded-full shadow-[0_0_8px_rgba(37,99,235,0.5)]"
                animate={{
                  x: [-60, 160],
                }}
                transition={{
                  repeat: Infinity,
                  duration: 1.15,
                  ease: 'easeInOut',
                }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default CanvasLoadingOverlay;
