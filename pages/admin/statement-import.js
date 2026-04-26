import dynamic from 'next/dynamic';

const StatementImportPage = dynamic(() => import('../../components/StatementImportPage'), {
  ssr: false,
});

export default function StatementImportRoute() {
  return <StatementImportPage />;
}
