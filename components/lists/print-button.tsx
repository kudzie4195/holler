'use client';

import { Button } from '@/components/button';

/** Opens the browser's print dialog for the page. Nothing is sent anywhere. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button size="sm" variant="primary" onClick={() => window.print()} className="print:hidden">
      {label}
    </Button>
  );
}
