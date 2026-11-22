import { Notice } from './notice';

/**
 * One calm line saying a source near the member is behind (lib/check/coverage-notice.ts). Renders nothing when there is no notice.
 * role="status": it is information, not an error.
 */
export function CoverageNoticeLine({ line }: { line: string | null | undefined }) {
  if (!line) return null;
  return (
    <div data-testid="coverage-notice">
      <Notice tone="warn" role="status">
        {line}
      </Notice>
    </div>
  );
}
