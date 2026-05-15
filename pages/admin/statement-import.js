import dynamic from 'next/dynamic';
import AdminPasswordGate from '../../components/AdminPasswordGate';

const StatementImportPage = dynamic(() => import('../../components/StatementImportPage'), {
  ssr: false,
});

export default function StatementImportRoute() {
  return (
    <AdminPasswordGate
      title="Statement importer locked"
      description="Enter the admin tools password to parse statements and push import rows."
    >
      <StatementImportPage />
    </AdminPasswordGate>
  );
}
