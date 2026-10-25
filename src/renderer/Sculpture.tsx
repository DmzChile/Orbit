import { useId, type CSSProperties } from "react";

// The reference's seven nested orbits are the only line geometries. Each
// afterglow reuses its own orbit, so there are no added tracks or connectors.
const orbits = [
  [94, 19, 11],
  [113, 25, 13],
  [134, 33, 15],
  [157, 42, 17],
  [182, 52, 20],
  [209, 63, 23],
  [237, 75, 27],
] as const;
// Nested lengths share one leading edge; their overlap makes a fading wake.
const wake = [72, 57, 44, 33, 23, 14, 7, 2];
export function Sculpture() {
  const id = useId();
  function rings(front = false) {
    return (
      <g
        className={front ? "orbit-front" : "orbit-back"}
        transform="rotate(27 250 140)"
        clipPath={front ? `url(#${id}-front)` : undefined}
      >
        {orbits.map(([, , duration], index) => (
          <g
            key={index}
            className="orbit-lane"
            style={
              {
                "--orbit-duration": `${duration}s`,
                "--orbit-delay": `${-index * 2.4 - 3}s`,
              } as CSSProperties
            }
          >
            <use
              href={`#${id}-track-${index}`}
              className="orbit-path"
              opacity={0.11 + (6 - index) * 0.016}
            />
            {wake.map((length, part) => (
              <use
                key={length}
                href={`#${id}-track-${index}`}
                className="orbit-trail"
                strokeDasharray={`${length} ${100 - length}`}
                style={
                  {
                    "--wake-length": `${length}px`,
                    opacity: [
                      0.018, 0.023, 0.03, 0.04, 0.055, 0.075, 0.105, 0.17,
                    ][part],
                    strokeWidth: part < 5 ? 0.8 : 1.05,
                  } as CSSProperties
                }
              />
            ))}
          </g>
        ))}
      </g>
    );
  }
  return (
    <div className="sculpture" aria-hidden="true">
      <svg className="orbit-scene" viewBox="0 0 440 280" focusable="false">
        <defs>
          <radialGradient id={`${id}-planet`} cx="30%" cy="23%" r="84%">
            <stop stopColor="#c5ede5" />
            <stop offset="0.36" stopColor="#8dc6c2" />
            <stop offset="0.7" stopColor="#4a8794" />
            <stop offset="1" stopColor="#224d64" />
          </radialGradient>
          <radialGradient id={`${id}-shade`} cx="25%" cy="20%" r="82%">
            <stop offset="0.32" stopColor="#142f46" stopOpacity="0" />
            <stop offset="0.8" stopColor="#142f46" stopOpacity="0.15" />
            <stop offset="1" stopColor="#102b42" stopOpacity="0.67" />
          </radialGradient>
          <radialGradient id={`${id}-atmosphere`}>
            <stop offset="0.72" stopColor="#9edbd7" stopOpacity="0" />
            <stop offset="0.82" stopColor="#9edbd7" stopOpacity="0.11" />
            <stop offset="1" stopColor="#9edbd7" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-band`} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#d8f4e9" stopOpacity="0.11" />
            <stop offset="0.6" stopColor="#234e68" stopOpacity="0.17" />
            <stop offset="1" stopColor="#93cecd" stopOpacity="0.07" />
          </linearGradient>
          <clipPath id={`${id}-sphere`}>
            <circle cx="250" cy="140" r="64" />
          </clipPath>
          <clipPath id={`${id}-front`}>
            <path d="M-100 140H650V500H-100Z" />
          </clipPath>
          {orbits.map(([rx, ry], index) => (
            <path
              key={index}
              id={`${id}-track-${index}`}
              className="orbit-geometry"
              pathLength="100"
              d={`M${250 + rx} 140a${rx} ${ry} 0 1 1 ${-2 * rx} 0a${rx} ${ry} 0 1 1 ${2 * rx} 0`}
            />
          ))}
        </defs>
        <g className="orbit-stars" fill="#b9d6df">
          <circle cx="18" cy="43" r="0.8" />
          <circle cx="81" cy="207" r="0.6" />
          <circle cx="134" cy="27" r="0.75" />
          <circle cx="366" cy="68" r="0.7" />
          <circle cx="319" cy="240" r="0.65" />
          <circle cx="407" cy="211" r="0.8" />
        </g>
        {rings()}
        <circle cx="250" cy="140" r="82" fill={`url(#${id}-atmosphere)`} />
        <circle
          className="planet"
          cx="250"
          cy="140"
          r="64"
          fill={`url(#${id}-planet)`}
        />
        <g clipPath={`url(#${id}-sphere)`}>
          <g transform="rotate(24 250 140)" fill={`url(#${id}-band)`}>
            <path d="M175 96Q250 114 328 96V106Q250 124 175 106Z" />
            <path d="M175 117Q250 133 328 117V136Q250 149 175 136Z" />
            <path d="M175 151Q250 167 328 151V159Q250 176 175 159Z" />
            <path d="M175 175Q250 186 328 175V189Q250 201 175 189Z" />
          </g>
          <circle cx="250" cy="140" r="64" fill={`url(#${id}-shade)`} />
        </g>
        {rings(true)}
      </svg>
    </div>
  );
}
