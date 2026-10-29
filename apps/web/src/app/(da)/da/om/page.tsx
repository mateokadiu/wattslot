import { InfoPage, infoMetadata } from '@/components/InfoPage';

export const metadata = infoMetadata('about', 'da');

export default function Page() {
  return <InfoPage page="about" locale="da" />;
}
