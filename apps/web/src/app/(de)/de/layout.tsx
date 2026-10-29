import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { metadataFor } from '@/lib/metadata';
import '../../globals.css';

export { viewport } from '@/lib/metadata';
export const metadata = metadataFor('de');

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${GeistSans.variable} ${GeistMono.variable} font-sans`}>
      <body>{children}</body>
    </html>
  );
}
