import { OutagesPage, outagesMetadata } from '@/components/OutagesPage';

export const metadata = outagesMetadata('da');

export default function Page() {
  return <OutagesPage locale="da" />;
}
