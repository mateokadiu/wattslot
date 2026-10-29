import { GuidePage, guideKeyFor, guideMetadata } from '@/components/GuidePage';
import { GUIDE_KEYS, GUIDE_SLUGS } from '@/content/guides';

export const dynamicParams = false;
export const generateStaticParams = () => GUIDE_KEYS.map((key) => ({ slug: GUIDE_SLUGS[key].en }));

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  return guideMetadata(guideKeyFor('en', (await params).slug), 'en');
}

export default async function Page({ params }: Props) {
  return <GuidePage guide={guideKeyFor('en', (await params).slug)} locale="en" />;
}
