import { InfoPage, infoMetadata } from '@/components/InfoPage';

export const metadata = infoMetadata('privacy', 'en');

export default function Page() {
  return <InfoPage page="privacy" locale="en" />;
}
