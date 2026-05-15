import dynamic from 'next/dynamic';
import AdminPasswordGate from '../../components/AdminPasswordGate';

const PerformanceDebuggerPage = dynamic(() => import('../../components/PerformanceDebuggerPage'), {
  ssr: false,
});

export default function PerformanceDebuggerRoute() {
  return (
    <AdminPasswordGate
      title="App speed check locked"
      description="Enter the admin tools password to check how responsive the app feels."
    >
      <PerformanceDebuggerPage />
    </AdminPasswordGate>
  );
}
