import { InfoPage, infoMetadata } from '@/components/InfoPage';

export const metadata = infoMetadata('about', 'en');

export default function Page() {
  return <InfoPage page="about" locale="en" />;
}
