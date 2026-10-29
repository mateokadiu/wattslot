import { GuidePage, guideKeyFor, guideMetadata } from '@/components/GuidePage';
import { GUIDE_KEYS, GUIDE_SLUGS } from '@/content/guides';

export const dynamicParams = false;
export const generateStaticParams = () => GUIDE_KEYS.map((key) => ({ slug: GUIDE_SLUGS[key].da }));

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  return guideMetadata(guideKeyFor('da', (await params).slug), 'da');
}

export default async function Page({ params }: Props) {
  return <GuidePage guide={guideKeyFor('da', (await params).slug)} locale="da" />;
}
