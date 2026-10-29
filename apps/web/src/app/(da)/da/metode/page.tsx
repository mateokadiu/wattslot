import { InfoPage, infoMetadata } from '@/components/InfoPage';

export const metadata = infoMetadata('method', 'da');

export default function Page() {
  return <InfoPage page="method" locale="da" />;
}
