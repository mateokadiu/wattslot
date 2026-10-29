import { CompanyPage, companyMetadata } from '@/components/CompanyPage';
import { companies } from '@/lib/load-facts';

export const dynamicParams = false;
export const generateStaticParams = () => companies().map((c) => ({ slug: c.slug }));

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  return companyMetadata((await params).slug, 'da');
}

export default async function Page({ params }: Props) {
  return <CompanyPage slug={(await params).slug} locale="da" />;
}
