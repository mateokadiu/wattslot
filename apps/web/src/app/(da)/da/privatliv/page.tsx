import { InfoPage, infoMetadata } from '@/components/InfoPage';

export const metadata = infoMetadata('privacy', 'da');

export default function Page() {
  return <InfoPage page="privacy" locale="da" />;
}
