import dynamic from 'next/dynamic';
import AdminPasswordGate from '../../components/AdminPasswordGate';

const AdminUploadPage = dynamic(() => import('../../components/AdminUploadPage'), {
  ssr: false,
});

export default function AdminUploadRoute() {
  return (
    <AdminPasswordGate
      title="Upload locked"
      description="Enter the admin tools password to upload and manage imported transactions."
    >
      <AdminUploadPage />
    </AdminPasswordGate>
  );
}
