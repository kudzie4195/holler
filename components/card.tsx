import type { ComponentProps } from 'react';

export function Card({
  className = '',
  padded = true,
  as: Tag = 'div',
  ...rest
}: { padded?: boolean; as?: 'div' | 'section' | 'article' | 'li' } & ComponentProps<'div'>) {
  return (
    <Tag
      className={`rounded-card border border-line bg-surface shadow-soft ${padded ? 'p-5 md:p-6' : ''} ${className}`}
      {...(rest as object)}
    />
  );
}
