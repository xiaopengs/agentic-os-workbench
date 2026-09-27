import { Suspense } from 'react';
import WorkflowsClient from './client';

export default function WorkflowsPage() {
  return (
    <Suspense fallback={<div className="splash">加载中…</div>}>
      <WorkflowsClient />
    </Suspense>
  );
}
