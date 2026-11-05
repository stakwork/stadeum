/** "Contours": nested rings drifting from two centres. Paths copied from the board's ArtContours artboard. */
const RING = "M0,-100 C60,-100 110,-55 105,0 C100,60 50,95 -5,100 C-65,105 -110,55 -100,-5 C-92,-60 -55,-100 0,-100 Z";
const TRANSFORMS = [
  "translate(430 300) scale(0.35)",
  "translate(432 302) scale(0.7) rotate(8)",
  "translate(436 306) scale(1.05) rotate(14)",
  "translate(440 312) scale(1.4) rotate(20)",
  "translate(444 318) scale(1.78) rotate(26)",
  "translate(448 326) scale(2.2) rotate(31)",
  "translate(452 334) scale(2.65) rotate(36)",
  "translate(456 344) scale(3.15) rotate(40)",
  "translate(460 356) scale(3.7) rotate(44)",
  "translate(464 370) scale(4.3) rotate(47)",
  "translate(120 160) scale(0.4) rotate(-20)",
  "translate(118 158) scale(0.8) rotate(-26)",
  "translate(114 154) scale(1.2) rotate(-32)",
];

export function Contours() {
  return (
    <svg viewBox="0 0 640 820" preserveAspectRatio="xMidYMid slice" aria-hidden className="absolute inset-0 size-full">
      <g fill="none" stroke="#23436B" strokeWidth="1.2" opacity="0.55">
        {TRANSFORMS.map((t) => (
          <path key={t} vectorEffect="non-scaling-stroke" transform={t} d={RING} />
        ))}
      </g>
      <circle cx="430" cy="300" r="5" fill="#23436B" />
    </svg>
  );
}
