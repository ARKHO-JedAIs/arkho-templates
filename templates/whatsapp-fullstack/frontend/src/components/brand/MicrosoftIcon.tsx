interface MicrosoftIconProps {
  className?: string;
}

/**
 * Microsoft's four-square mark, for the "Iniciar sesión con Microsoft" button.
 * The fills are Microsoft's own brand colours, not theme tokens: the provider's
 * guidelines require the mark unaltered. Decorative - the button carries the name.
 */
export function MicrosoftIcon({ className }: MicrosoftIconProps) {
  return (
    <svg
      viewBox='0 0 21 21'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      aria-hidden='true'
      focusable='false'
    >
      <rect x='1' y='1' width='9' height='9' fill='#F25022' />
      <rect x='11' y='1' width='9' height='9' fill='#7FBA00' />
      <rect x='1' y='11' width='9' height='9' fill='#00A4EF' />
      <rect x='11' y='11' width='9' height='9' fill='#FFB900' />
    </svg>
  );
}

export default MicrosoftIcon;
