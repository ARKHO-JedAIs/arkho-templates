import brand from '@/styles/brand.json';
import { cn } from '@/lib/utils';

interface BrandMarkProps {
  appName: string;
  /** On a coloured or dark surface: prefers `logoOnDark` from brand.json. */
  onDark?: boolean;
  className?: string;
}

/** The logo of brand.json, or the app name as a wordmark until there is one. */
export function BrandMark({ appName, onDark, className }: BrandMarkProps) {
  const src = (onDark && brand.logoOnDark) || brand.logo;
  if (src) return <img src={src} alt={appName} className={cn('h-8 w-auto', className)} />;
  return <span className={cn('text-xl font-semibold tracking-tight', className)}>{appName}</span>;
}

/** The logo for a decorative brand image, or null when brand.json has none. */
export function brandLogo(onDark = false): string | null {
  return (onDark && brand.logoOnDark) || brand.logo || null;
}
