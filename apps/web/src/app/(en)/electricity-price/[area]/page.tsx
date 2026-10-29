import { AreaPage, areaMetadata } from '@/components/AreaPage';
import type { AreaCode } from '@/content/directory';
import { AREAS } from '@/lib/routes';

export const dynamicParams = false;
export const generateStaticParams = () => AREAS.map((area) => ({ area }));

type Props = { params: Promise<{ area: AreaCode }> };

export async function generateMetadata({ params }: Props) {
  return areaMetadata((await params).area, 'en');
}

export default async function Page({ params }: Props) {
  return <AreaPage code={(await params).area} locale="en" />;
}
