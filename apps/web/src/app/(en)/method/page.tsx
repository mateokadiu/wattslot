import { InfoPage, infoMetadata } from '@/components/InfoPage';

export const metadata = infoMetadata('method', 'en');

export default function Page() {
  return <InfoPage page="method" locale="en" />;
}
