import React from 'react';

export type LogoMorphPhase =
  | 'camera-spin'
  | 'morph-to-m'
  | 'writing'
  | 'complete';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /**
   * Fluid Transition to White 'M' + Real-Time Pacifico Handwriting (~2.55s total):
   * 1. 'camera-spin' (0.00s - 0.62s): Minimalist white camera lens spins smoothly
   * 2. 'morph-to-m'  (0.62s - 1.15s): Camera aperture blades unfold into the geometric white letter 'M'
   * 3. 'writing'     (1.15s - 2.55s): 'M' glides left while 'ovieJournal' is written in real time (1.4s)
   * 4. 'complete'    (2.55s+): Full 'MovieJournal' signature complete with 0px shift
   */
  phase?: LogoMorphPhase;
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'lg',
  phase = 'complete',
  className = '',
}) => {
  const isSpinning = phase === 'camera-spin';
  const isMorphedToM =
    phase === 'morph-to-m' ||
    phase === 'writing' ||
    phase === 'complete';
  const isWritingOrComplete = phase === 'writing' || phase === 'complete';
  const isActivelyWriting = phase === 'writing';
  const isFullyComplete = phase === 'complete';

  // Fluid viewport-proportional dimensions using CSS clamp() so the logo never overflows narrow phones
  // and scales continuously across iPhone SE (320px), iPhone 15/16 (390px), iPad, and Desktop.
  // Note: 'lg' and 'xl' share identical fluid metrics so transitioning from IntroOpener to AuthView has 0px size jump.
  const config = {
    sm: {
      boxStyle: 'clamp(26px, 7.2vw, 34px)',
      svgWidthStyle: 'clamp(118px, 35vw, 166px)',
      svgHeightStyle: 'clamp(36px, 10.8vw, 52px)',
      overlapStyle: 'clamp(-6px, -1.2vw, -4px)',
    },
    md: {
      boxStyle: 'clamp(32px, 9vw, 44px)',
      svgWidthStyle: 'clamp(148px, 45vw, 214px)',
      svgHeightStyle: 'clamp(45px, 13.8vw, 66px)',
      overlapStyle: 'clamp(-7px, -1.4vw, -5px)',
    },
    lg: {
      boxStyle: 'clamp(38px, 11vw, 54px)',
      svgWidthStyle: 'clamp(178px, 56vw, 268px)',
      svgHeightStyle: 'clamp(54px, 17vw, 82px)',
      overlapStyle: 'clamp(-8px, -1.6vw, -5px)',
    },
    xl: {
      boxStyle: 'clamp(38px, 11vw, 54px)',
      svgWidthStyle: 'clamp(178px, 56vw, 268px)',
      svgHeightStyle: 'clamp(54px, 17vw, 82px)',
      overlapStyle: 'clamp(-8px, -1.6vw, -5px)',
    },
  }[size];

  // Fixed internal vector coordinate space (scales seamlessly to any fluid clamp() box)
  const VB_W = 286;
  const VB_H = 86;
  const FONT_SIZE = 49;

  return (
    <div
      className={`inline-flex items-center justify-center max-w-[90vw] select-none ${className}`}
    >
      <div className="relative flex items-center justify-center max-w-full">
        {/* Soft Pure White Ambient Halo */}
        <div
          className={`absolute -inset-6 rounded-full bg-white/[0.07] blur-xl pointer-events-none transition-opacity duration-500 ${
            isSpinning ? 'opacity-90' : 'opacity-50'
          }`}
        />

        {/* 1. The Spinning White Camera Lens -> Unfolds Fluidly into Architectural White 'M' */}
        <div
          style={{ width: config.boxStyle, height: config.boxStyle }}
          className="relative z-10 flex items-center justify-center flex-shrink-0 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
        >
          <svg
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-full overflow-visible drop-shadow-[0_6px_20px_rgba(255,255,255,0.28)]"
          >
            {/* Outer Cinema Camera Lens Ring */}
            <g
              className="origin-center transition-all duration-[620ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                transform: isSpinning
                  ? 'rotate(0deg) scale(1)'
                  : 'rotate(180deg) scale(1.2)',
                opacity: isSpinning ? 1 : 0,
              }}
            >
              <circle
                cx="50"
                cy="50"
                r="40"
                stroke="#FFFFFF"
                strokeWidth="5"
                strokeOpacity="0.92"
              />
              <circle
                cx="50"
                cy="50"
                r="29"
                stroke="#FFFFFF"
                strokeWidth="2"
                strokeDasharray="6 6"
                strokeOpacity="0.55"
              />
              <rect
                x="88"
                y="41"
                width="8"
                height="18"
                rx="3"
                fill="#FFFFFF"
                fillOpacity="0.9"
              />
              <circle cx="50" cy="50" r="4.5" fill="#FFFFFF" />
            </g>

            {/* 4 Pure White Camera Aperture Blades that Geometrically Unfold into 'M' */}
            <g
              className="origin-center transition-transform duration-[620ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{
                transform: isSpinning
                  ? 'rotate(-180deg) scale(0.76)'
                  : 'rotate(0deg) scale(1)',
              }}
            >
              {/* Blade 1 -> Left Vertical Stem of 'M' */}
              <rect
                x="14"
                y="16"
                width="12.5"
                height="68"
                rx="6.25"
                fill="#FFFFFF"
                className="transition-all duration-[580ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{
                  transformOrigin: '20.25px 50px',
                  transform: isMorphedToM
                    ? 'translate(0px, 0px) rotate(0deg) scaleY(1)'
                    : 'translate(29.75px, -18px) rotate(90deg) scaleY(0.58)',
                }}
              />

              {/* Blade 2 -> Left Diagonal Stroke of 'M' */}
              <rect
                x="14"
                y="16"
                width="12.5"
                height="54"
                rx="6.25"
                fill="#FFFFFF"
                className="transition-all duration-[580ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{
                  transformOrigin: '20.25px 22.5px',
                  transform: isMorphedToM
                    ? 'translate(3px, 2px) rotate(-33deg) scaleY(1)'
                    : 'translate(11.5px, 27.5px) rotate(0deg) scaleY(0.68)',
                }}
              />

              {/* Blade 3 -> Right Diagonal Stroke of 'M' */}
              <rect
                x="73.5"
                y="16"
                width="12.5"
                height="54"
                rx="6.25"
                fill="#FFFFFF"
                className="transition-all duration-[580ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{
                  transformOrigin: '79.75px 22.5px',
                  transform: isMorphedToM
                    ? 'translate(-3px, 2px) rotate(33deg) scaleY(1)'
                    : 'translate(-11.5px, 27.5px) rotate(0deg) scaleY(0.68)',
                }}
              />

              {/* Blade 4 -> Right Vertical Stem of 'M' */}
              <rect
                x="73.5"
                y="16"
                width="12.5"
                height="68"
                rx="6.25"
                fill="#FFFFFF"
                className="transition-all duration-[580ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{
                  transformOrigin: '79.75px 50px',
                  transform: isMorphedToM
                    ? 'translate(0px, 0px) rotate(0deg) scaleY(1)'
                    : 'translate(-29.75px, 18px) rotate(90deg) scaleY(0.58)',
                }}
              />
            </g>
          </svg>
        </div>

        {/* 2. Fluid Responsive Pacifico Handwriting Container ('ovieJournal') */}
        <div
          style={{
            width: isWritingOrComplete ? config.svgWidthStyle : '0px',
            height: config.svgHeightStyle,
            marginLeft: isWritingOrComplete ? config.overlapStyle : '0px',
          }}
          className={`relative overflow-visible transition-[width,margin,opacity] duration-[500ms] ease-[cubic-bezier(0.16,1,0.3,1)] flex items-center ${
            isWritingOrComplete
              ? 'opacity-100'
              : 'opacity-0 pointer-events-none'
          }`}
        >
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="xMinYMid meet"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-full overflow-visible drop-shadow-[0_4px_14px_rgba(255,255,255,0.2)]"
          >
            <defs>
              {/* Progressive Left-to-Right Real-Time Writing Clip in viewBox units */}
              <clipPath id={`mj-pen-clip-${size}`}>
                <rect
                  x="0"
                  y="-24"
                  height={VB_H + 48}
                  className={
                    isActivelyWriting
                      ? 'animate-handwriting-clip'
                      : isFullyComplete
                      ? 'w-full'
                      : 'w-0'
                  }
                  style={{
                    width: isFullyComplete ? VB_W + 30 : undefined,
                  }}
                />
              </clipPath>
            </defs>

            {/* Single Unified Pacifico Text Layer — Identical geometry during 'writing' and 'complete' so 0px twitch occurs */}
            <text
              x="6"
              y={VB_H * 0.7}
              fontFamily="'Pacifico', cursive"
              fontSize={FONT_SIZE}
              fill="#FFFFFF"
              clipPath={`url(#mj-pen-clip-${size})`}
              className={
                isActivelyWriting
                  ? 'animate-handwriting-fill'
                  : isFullyComplete
                  ? 'opacity-100'
                  : 'opacity-0'
              }
              style={{
                letterSpacing: '0.02em',
              }}
            >
              ovieJournal
            </text>

            {/* Delicate Signature Underline Sweep */}
            <path
              d={`M ${VB_W * 0.35} ${VB_H * 0.88} Q ${VB_W * 0.66} ${
                VB_H * 0.81
              } ${VB_W * 0.94} ${VB_H * 0.86}`}
              stroke="#FFFFFF"
              strokeOpacity="0.65"
              strokeWidth="1.35"
              strokeLinecap="round"
              className={
                isActivelyWriting
                  ? 'animate-signature-flourish'
                  : isFullyComplete
                  ? 'opacity-65'
                  : 'opacity-0'
              }
              style={{
                strokeDasharray: 220,
                strokeDashoffset: isFullyComplete ? 0 : undefined,
              }}
            />
          </svg>
        </div>
      </div>

      <style>{`
        @keyframes handwritingClip {
          0% { width: 0px; }
          15% { width: 45px; }
          32% { width: 96px; }
          50% { width: 148px; }
          68% { width: 204px; }
          85% { width: 256px; }
          100% { width: 310px; }
        }
        @keyframes handwritingFill {
          0% { opacity: 0.65; }
          25% { opacity: 0.95; }
          100% { opacity: 1; }
        }
        @keyframes signatureFlourish {
          0%, 70% {
            stroke-dashoffset: 220;
            opacity: 0;
          }
          78% {
            opacity: 0.75;
          }
          100% {
            stroke-dashoffset: 0;
            opacity: 0.65;
          }
        }
        .animate-handwriting-clip {
          animation: handwritingClip 1.35s cubic-bezier(0.33, 0, 0.58, 1) forwards;
        }
        .animate-handwriting-fill {
          animation: handwritingFill 1.35s ease-out forwards;
        }
        .animate-signature-flourish {
          animation: signatureFlourish 1.35s ease-out forwards;
        }
      `}</style>
    </div>
  );
};
