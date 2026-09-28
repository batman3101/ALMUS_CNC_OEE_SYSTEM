import { Suspense } from 'react';
import LayoutStudio from '@/components/layout-studio/LayoutStudio';

// LayoutStudio reads ?plan= with useSearchParams, which needs a Suspense boundary on a prerendered route.
export default function LayoutStudioPage() {
  return <Suspense fallback={null}><LayoutStudio /></Suspense>;
}
