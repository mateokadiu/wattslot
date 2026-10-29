import { CompaniesHub, hubMetadata } from '@/components/CompaniesHub';

export const metadata = hubMetadata('da');

export default function Page() {
  return <CompaniesHub locale="da" />;
}
