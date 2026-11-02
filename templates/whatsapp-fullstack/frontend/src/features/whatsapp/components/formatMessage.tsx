import type { ReactNode } from 'react';

/**
 * WhatsApp's inline formatting - `*bold*`, `_italic_`, `~strikethrough~` - as
 * React nodes. Built from text nodes, never HTML, so whatever a contact writes
 * is shown, not interpreted.
 */
const INLINE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;

export function formatMessage(text: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    if (part.length > 2) {
      const inner = part.slice(1, -1);
      if (part.startsWith('*') && part.endsWith('*')) return <strong key={index}>{inner}</strong>;
      if (part.startsWith('_') && part.endsWith('_')) return <em key={index}>{inner}</em>;
      if (part.startsWith('~') && part.endsWith('~')) return <s key={index}>{inner}</s>;
    }
    return part;
  });
}
