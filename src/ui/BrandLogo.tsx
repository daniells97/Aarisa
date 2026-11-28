// Aarisa Consulting logo files (public/brand, made by scripts/make-brand-assets.mjs from design/brand/source).
const files = {
  horizontal: { src: '/brand/aarisa-logo.png', w: 571, h: 181 },
  stacked: { src: '/brand/aarisa-logo-stacked.png', w: 176, h: 177 },
  mark: { src: '/brand/aarisa-mark.png', w: 235, h: 175 },
} as const;

export function BrandLogo({ variant = 'horizontal', height, decorative = false }: { variant?: keyof typeof files; height: number; decorative?: boolean }) {
  const f = files[variant];
  return (
    <img
      src={f.src}
      width={Math.round((f.w / f.h) * height)}
      height={height}
      alt={decorative ? '' : 'Aarisa Consulting'}
      className="brand-logo"
      decoding="async"
    />
  );
}
