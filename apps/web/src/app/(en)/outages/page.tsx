import { OutagesPage, outagesMetadata } from '@/components/OutagesPage';

export const metadata = outagesMetadata('en');

export default function Page() {
  return <OutagesPage locale="en" />;
}
