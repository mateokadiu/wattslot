import { CompaniesHub, hubMetadata } from '@/components/CompaniesHub';

export const metadata = hubMetadata('en');

export default function Page() {
  return <CompaniesHub locale="en" />;
}
