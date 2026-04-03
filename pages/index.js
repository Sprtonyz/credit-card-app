import dynamic from 'next/dynamic';

const CreditCardApp = dynamic(() => import('../components/CreditCardApp'), {
  ssr: false,
});

export default function Home() {
  return (
    <div>
      <CreditCardApp />
    </div>
  );
}
