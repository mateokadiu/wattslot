import { GeistSans } from 'geist/font/sans';
import { metadataFor } from '@/lib/metadata';
import '../../globals.css';

export { viewport } from '@/lib/metadata';
export const metadata = metadataFor('da');

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da" className={GeistSans.className}>
      <body>{children}</body>
    </html>
  );
}
