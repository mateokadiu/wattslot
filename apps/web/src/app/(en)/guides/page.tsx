import { GuidesHub, guidesHubMetadata } from '@/components/GuidePage';

export const metadata = guidesHubMetadata('en');

export default function Page() {
  return <GuidesHub locale="en" />;
}
