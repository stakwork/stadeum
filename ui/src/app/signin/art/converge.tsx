/**
 * "Converge": twelve streams meeting at one point and leaving as a single
 * line. Paths copied from the design board's ArtConverge artboard.
 */
const STREAMS: Array<[number, string]> = [
  [0.25, "M-20,70 C160,70 300,300 480,320"],
  [0.35, "M-20,115 C170,115 300,305 480,322"],
  [0.3, "M-20,160 C180,160 310,310 480,324"],
  [0.45, "M-20,205 C190,205 320,315 480,326"],
  [0.35, "M-20,250 C200,250 330,320 480,328"],
  [0.55, "M-20,295 C210,295 340,325 480,330"],
  [0.55, "M-20,345 C210,345 340,335 480,332"],
  [0.4, "M-20,395 C200,395 330,340 480,334"],
  [0.45, "M-20,440 C190,440 320,345 480,336"],
  [0.3, "M-20,485 C180,485 310,350 480,338"],
  [0.35, "M-20,530 C170,530 300,355 480,340"],
  [0.25, "M-20,575 C160,575 300,360 480,342"],
];

export function Converge() {
  return (
    <svg
      viewBox="0 0 640 820"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      className="absolute inset-0 size-full"
    >
      <g fill="none" stroke="#F6F4EE" strokeWidth="1.2" strokeLinecap="round">
        {STREAMS.map(([opacity, d]) => (
          <path key={d} opacity={opacity} d={d} />
        ))}
      </g>
      <path d="M480,331 L660,331" stroke="#F6F4EE" strokeWidth="5" strokeLinecap="round" />
      <circle cx="480" cy="331" r="7" fill="#C99A4B" />
    </svg>
  );
}
