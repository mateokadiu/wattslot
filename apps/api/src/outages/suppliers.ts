/**
 * Green Power Denmark's outage portal identifies grid companies by its own supplier ids, and
 * keeps old ids after mergers. This maps them to our grid companies (one GLN per company: the
 * largest grid area), with the phone number and outage page we show. Checked 2026-10-31 against
 * https://api.elnet.greenpowerdenmark.dk/api/Suppliers; ids not listed here are electricity
 * retailers or the portal itself, whose incidents are shown without a company link.
 */
export interface OutageCompany {
  gln: string;
  supplierIds: number[];
  /** Fault line, as the portal lists it. */
  phone: string;
  /** The company's own outage page, where we found one; null otherwise. */
  page: string | null;
  /**
   * Whether the company reports outages to the portal. On 2026-10-31, ten small companies had
   * no incidents there in 90 days; their pages point people to the company instead.
   */
  reports: boolean;
}

const SILENT = new Set([
  '5790001095277', // Elinord
  '5790001088217', // Veksel
  '5790000682102', // Ikast El Net
  '5790001095239', // Kimbrer
  '5790001095376', // Hjerting
  '5790001103460', // Læsø
  '5790001095444', // Sunds Net
  '5790000706419', // Tarm Elværk Net
  '5790001095451', // Aal El-Net
  '5790000610839', // Hurup
]);

const COMPANIES: Omit<OutageCompany, 'reports'>[] = [
  {
    gln: '5790000705689', // Radius Elnet
    supplierIds: [4, 65],
    phone: '+45 70 20 58 00',
    page: 'https://radiuselnet.dk/stroemafbrydelse/',
  },
  {
    gln: '5790001089030', // N1 (largest grid area, 131); incl. former EnergiMidt, Nyfors, Kjellerup
    supplierIds: [5, 17, 18, 31, 43, 67, 81, 84],
    phone: '+45 70 23 00 43',
    page: 'https://n1.dk/driftsstatus',
  },
  {
    gln: '5790000705184', // Cerius
    supplierIds: [7, 30, 62, 71],
    phone: '+45 70 29 20 24',
    page: 'https://cerius.dk/stroemafbrydelse/',
  },
  {
    gln: '5790000610976', // Vores Elnet, incl. former Energi Fyn Net
    supplierIds: [13, 49],
    phone: '+45 63 10 81 00',
    page: 'https://www.voreselnet.dk/elnettet/driftsmeddelelser',
  },
  { gln: '5790000704842', supplierIds: [15], phone: '+45 70 11 45 09', page: null }, // Konstant
  {
    gln: '5790000392261', // TREFOR El-net
    supplierIds: [34],
    phone: '+45 79 33 34 35',
    page: 'https://www.trefor.dk/driftsinfo/',
  },
  {
    gln: '5790000610099', // Dinel
    supplierIds: [14],
    phone: '+45 87 92 55 66',
    page: 'https://dinel.dk/driftsinfo/',
  },
  {
    gln: '5790000610877', // Nord Energi Net
    supplierIds: [16],
    phone: '+45 99 24 56 56',
    page: 'https://nordenerginet.dk/',
  },
  {
    gln: '5790000681327', // RAH Net, incl. former Videbæk Elnet and MES Net (same fault line)
    supplierIds: [51, 83, 10],
    phone: '+45 44 22 77 77',
    page: 'https://rahnet.dk/elnettet/driftstatus/',
  },
  {
    gln: '5790000681358', // Netselskabet Elværk
    supplierIds: [26],
    phone: '+45 72 19 89 80',
    page: 'https://www.elvrk.dk/stroemsvigt/',
  },
  { gln: '5790000392551', supplierIds: [3], phone: '+45 62 21 27 71', page: null }, // FLOW Elnet
  { gln: '5790000395620', supplierIds: [11], phone: '+45 96 11 10 00', page: null }, // NOE Net
  {
    gln: '5790000706686', // TREFOR El-net Øst
    supplierIds: [59],
    phone: '+45 56 93 09 50',
    page: 'https://www.trefor.dk/oest/driftsinfo/',
  },
  {
    gln: '5790001089375', // Zeanet
    supplierIds: [35],
    phone: '+45 58 36 26 00',
    page: 'https://www.zeanet.dk/kortvisning-af-driftsforstyrrelser',
  },
  {
    gln: '5790001100520', // Elnet Midt
    supplierIds: [57],
    phone: '+45 89 28 88 00',
    page: 'https://www.elnetmidt.dk/driftsstatus/',
  },
  {
    gln: '5790001095277', // Elinord
    supplierIds: [52],
    phone: '+45 98 29 99 00',
    page: 'https://www.elinord.dk/driftsinformation',
  },
  {
    gln: '5790001090111', // L-Net
    supplierIds: [32],
    phone: '+45 77 77 00 11',
    page: 'https://www.l-net.dk/driftsinfo/',
  },
  { gln: '5790000836239', supplierIds: [66], phone: '+45 48 40 50 70', page: null }, // Elektrus
  {
    gln: '5790000836727', // Ravdex
    supplierIds: [44],
    phone: '+45 63 32 11 33',
    page: 'https://ravdex.dk/driftsstatus-lige-nu/',
  },
  { gln: '5790001088217', supplierIds: [12], phone: '+45 62 51 40 58', page: null }, // Veksel
  { gln: '5790000682102', supplierIds: [29], phone: '+45 96 60 00 33', page: null }, // Ikast El Net
  { gln: '5790001089023', supplierIds: [60], phone: '+45 62 62 11 09', page: null }, // Midtfyns
  {
    gln: '5790001088309', // Forsyning Elnet
    supplierIds: [41],
    phone: '+45 69 88 44 80',
    page: 'https://forsyningelnet.dk/driftstatus/',
  },
  { gln: '5790000681105', supplierIds: [69], phone: '+45 76 72 04 10', page: null }, // Grindsted
  { gln: '5790001095239', supplierIds: [88], phone: '+45 23 27 07 66', page: null }, // Kimbrer
  {
    gln: '5790001090166', // Hammel Elforsyning Net
    supplierIds: [61],
    phone: '+45 87 48 92 92',
    page: 'https://hammelelforsyning.dk/hl/selvbetjening/stroemsvigt.aspx',
  },
  {
    gln: '5790001095376', // Hjerting Transformatorforening
    supplierIds: [89],
    phone: '+45 75 11 55 78',
    page: 'https://hev.dk/driftsinfo/',
  },
  { gln: '5790001103460', supplierIds: [87], phone: '+45 44 45 64 00', page: null }, // Læsø
  { gln: '5790001095444', supplierIds: [85], phone: '+45 97 14 14 14', page: null }, // Sunds Net
  {
    gln: '5790000706419', // Tarm Elværk Net
    supplierIds: [82],
    phone: '+45 97 37 10 87',
    page: 'https://tarmenergi.dk/driftsstatus',
  },
  { gln: '5790001095451', supplierIds: [73], phone: '+45 40 25 34 09', page: null }, // Aal El-Net
  { gln: '5790000610839', supplierIds: [86], phone: '+45 97 95 15 22', page: null }, // Hurup
];

export const OUTAGE_COMPANIES: OutageCompany[] = COMPANIES.map((c) => ({
  ...c,
  reports: !SILENT.has(c.gln),
}));

/** Companies' smaller grid areas share the main area's fault line and outage reports. */
const AREA_ALIASES: Record<string, string> = {
  '5790000611003': '5790001089030', // N1 344 → N1 131
  '5790002502699': '5790001089030', // N1 016 → N1 131
  '5790000683345': '5790000704842', // Konstant 245 → Konstant 151
};

const BY_GLN = new Map<string, OutageCompany>(OUTAGE_COMPANIES.map((c) => [c.gln, c]));
for (const [alias, main] of Object.entries(AREA_ALIASES)) {
  const company = BY_GLN.get(main);
  if (company) BY_GLN.set(alias, company);
}

/** The GLN outages are filed under for a grid company, given any of its grid areas' GLNs. */
export const mainGln = (gln: string): string => AREA_ALIASES[gln] ?? gln;

/** Fault line, outage page and reporting for a grid company (by any of its listed GLNs). */
export const outageInfo = (gln: string): OutageCompany | null => BY_GLN.get(gln) ?? null;

const BY_SUPPLIER = new Map(
  OUTAGE_COMPANIES.flatMap((c) => c.supplierIds.map((id) => [id, c.gln] as const)),
);

/** Our grid company for one of the portal's supplier ids, or null. */
export const glnForSupplier = (supplierId: number): string | null =>
  BY_SUPPLIER.get(supplierId) ?? null;
