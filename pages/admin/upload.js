import dynamic from 'next/dynamic';

const AdminUploadPage = dynamic(() => import('../../components/AdminUploadPage'), {
  ssr: false,
});

export default function AdminUploadRoute() {
  return <AdminUploadPage />;
}
