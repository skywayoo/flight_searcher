/**
 * Airport data for AirportPicker component.
 * Scope: Asia-Pacific + New Zealand.
 *
 * Each airport has IATA code, Chinese name, English name, and country.
 */

export interface Airport {
  code: string;       // IATA code (3 letters)
  zhName: string;     // Chinese name (機場 / 城市)
  enName: string;     // English name
  country: string;    // Country (for grouping)
  countryZh: string;  // Country Chinese name
}

export const AIRPORTS: Airport[] = [
  // === 台灣 ===
  { code: 'TPE', zhName: '桃園', enName: 'Taoyuan', country: 'TW', countryZh: '台灣' },
  { code: 'TSA', zhName: '松山', enName: 'Taipei Songshan', country: 'TW', countryZh: '台灣' },
  { code: 'KHH', zhName: '高雄', enName: 'Kaohsiung', country: 'TW', countryZh: '台灣' },
  { code: 'RMQ', zhName: '台中', enName: 'Taichung', country: 'TW', countryZh: '台灣' },
  { code: 'TNN', zhName: '台南', enName: 'Tainan', country: 'TW', countryZh: '台灣' },

  // === 日本 ===
  { code: 'NRT', zhName: '成田', enName: 'Narita', country: 'JP', countryZh: '日本' },
  { code: 'HND', zhName: '羽田', enName: 'Haneda', country: 'JP', countryZh: '日本' },
  { code: 'KIX', zhName: '關西', enName: 'Kansai', country: 'JP', countryZh: '日本' },
  { code: 'NGO', zhName: '中部', enName: 'Chubu Centrair', country: 'JP', countryZh: '日本' },
  { code: 'FUK', zhName: '福岡', enName: 'Fukuoka', country: 'JP', countryZh: '日本' },
  { code: 'CTS', zhName: '札幌新千歲', enName: 'Sapporo New Chitose', country: 'JP', countryZh: '日本' },
  { code: 'OKA', zhName: '沖繩那霸', enName: 'Naha', country: 'JP', countryZh: '日本' },
  { code: 'HIJ', zhName: '廣島', enName: 'Hiroshima', country: 'JP', countryZh: '日本' },
  { code: 'KMJ', zhName: '熊本', enName: 'Kumamoto', country: 'JP', countryZh: '日本' },
  { code: 'KOJ', zhName: '鹿兒島', enName: 'Kagoshima', country: 'JP', countryZh: '日本' },
  { code: 'TAK', zhName: '高松', enName: 'Takamatsu', country: 'JP', countryZh: '日本' },

  // === 韓國 ===
  { code: 'ICN', zhName: '仁川', enName: 'Incheon', country: 'KR', countryZh: '韓國' },
  { code: 'GMP', zhName: '金浦', enName: 'Gimpo', country: 'KR', countryZh: '韓國' },
  { code: 'PUS', zhName: '釜山', enName: 'Busan', country: 'KR', countryZh: '韓國' },
  { code: 'CJU', zhName: '濟州', enName: 'Jeju', country: 'KR', countryZh: '韓國' },
  { code: 'TAE', zhName: '大邱', enName: 'Daegu', country: 'KR', countryZh: '韓國' },

  // === 中國 ===
  { code: 'PEK', zhName: '北京首都', enName: 'Beijing Capital', country: 'CN', countryZh: '中國' },
  { code: 'PKX', zhName: '北京大興', enName: 'Beijing Daxing', country: 'CN', countryZh: '中國' },
  { code: 'PVG', zhName: '上海浦東', enName: 'Shanghai Pudong', country: 'CN', countryZh: '中國' },
  { code: 'SHA', zhName: '上海虹橋', enName: 'Shanghai Hongqiao', country: 'CN', countryZh: '中國' },
  { code: 'CAN', zhName: '廣州', enName: 'Guangzhou', country: 'CN', countryZh: '中國' },
  { code: 'SZX', zhName: '深圳', enName: 'Shenzhen', country: 'CN', countryZh: '中國' },
  { code: 'CTU', zhName: '成都天府', enName: 'Chengdu Tianfu', country: 'CN', countryZh: '中國' },
  { code: 'XIY', zhName: '西安', enName: 'Xian', country: 'CN', countryZh: '中國' },

  // === 香港 / 澳門 ===
  { code: 'HKG', zhName: '香港', enName: 'Hong Kong', country: 'HK', countryZh: '香港' },
  { code: 'MFM', zhName: '澳門', enName: 'Macau', country: 'MO', countryZh: '澳門' },

  // === 東南亞 ===
  { code: 'SIN', zhName: '新加坡', enName: 'Singapore Changi', country: 'SG', countryZh: '新加坡' },
  { code: 'BKK', zhName: '曼谷蘇凡納布', enName: 'Bangkok Suvarnabhumi', country: 'TH', countryZh: '泰國' },
  { code: 'DMK', zhName: '曼谷廊曼', enName: 'Bangkok Don Mueang', country: 'TH', countryZh: '泰國' },
  { code: 'HKT', zhName: '普吉', enName: 'Phuket', country: 'TH', countryZh: '泰國' },
  { code: 'CNX', zhName: '清邁', enName: 'Chiang Mai', country: 'TH', countryZh: '泰國' },
  { code: 'KUL', zhName: '吉隆坡', enName: 'Kuala Lumpur', country: 'MY', countryZh: '馬來西亞' },
  { code: 'PEN', zhName: '檳城', enName: 'Penang', country: 'MY', countryZh: '馬來西亞' },
  { code: 'MNL', zhName: '馬尼拉', enName: 'Manila', country: 'PH', countryZh: '菲律賓' },
  { code: 'CEB', zhName: '宿霧', enName: 'Cebu', country: 'PH', countryZh: '菲律賓' },
  { code: 'CGK', zhName: '雅加達', enName: 'Jakarta Soekarno-Hatta', country: 'ID', countryZh: '印尼' },
  { code: 'DPS', zhName: '峇里島', enName: 'Bali Denpasar', country: 'ID', countryZh: '印尼' },
  { code: 'SGN', zhName: '胡志明市', enName: 'Ho Chi Minh', country: 'VN', countryZh: '越南' },
  { code: 'HAN', zhName: '河內', enName: 'Hanoi', country: 'VN', countryZh: '越南' },
  { code: 'DAD', zhName: '峴港', enName: 'Da Nang', country: 'VN', countryZh: '越南' },
  { code: 'PNH', zhName: '金邊', enName: 'Phnom Penh', country: 'KH', countryZh: '柬埔寨' },
  { code: 'REP', zhName: '暹粒', enName: 'Siem Reap', country: 'KH', countryZh: '柬埔寨' },

  // === 紐西蘭 ===
  { code: 'AKL', zhName: '奧克蘭', enName: 'Auckland', country: 'NZ', countryZh: '紐西蘭' },
  { code: 'WLG', zhName: '威靈頓', enName: 'Wellington', country: 'NZ', countryZh: '紐西蘭' },
  { code: 'CHC', zhName: '基督城', enName: 'Christchurch', country: 'NZ', countryZh: '紐西蘭' },
  { code: 'ZQN', zhName: '皇后鎮', enName: 'Queenstown', country: 'NZ', countryZh: '紐西蘭' },
  { code: 'DUD', zhName: '但尼丁', enName: 'Dunedin', country: 'NZ', countryZh: '紐西蘭' },
  { code: 'NSN', zhName: '尼爾森', enName: 'Nelson', country: 'NZ', countryZh: '紐西蘭' },
  { code: 'ROT', zhName: '羅托魯瓦', enName: 'Rotorua', country: 'NZ', countryZh: '紐西蘭' },

  // === 澳洲(順帶,亞太常用) ===
  { code: 'SYD', zhName: '雪梨', enName: 'Sydney', country: 'AU', countryZh: '澳洲' },
  { code: 'MEL', zhName: '墨爾本', enName: 'Melbourne', country: 'AU', countryZh: '澳洲' },
  { code: 'BNE', zhName: '布里斯本', enName: 'Brisbane', country: 'AU', countryZh: '澳洲' },
  { code: 'PER', zhName: '伯斯', enName: 'Perth', country: 'AU', countryZh: '澳洲' },
];

// 國家順序(顯示用)
export const COUNTRY_ORDER = [
  'TW', 'JP', 'KR', 'HK', 'MO', 'CN',
  'SG', 'TH', 'MY', 'PH', 'ID', 'VN', 'KH',
  'NZ', 'AU',
];

// 快速群組(可從 UI 一鍵選取)
export const QUICK_GROUPS: { name: string; codes: string[] }[] = [
  { name: '台北', codes: ['TPE', 'TSA'] },
  { name: '日本主要', codes: ['NRT', 'HND', 'KIX', 'NGO'] },
  { name: '日本全部', codes: ['NRT', 'HND', 'KIX', 'NGO', 'FUK', 'CTS', 'OKA', 'HIJ', 'KMJ', 'KOJ', 'TAK'] },
  { name: '韓國主要', codes: ['ICN', 'GMP'] },
  { name: '韓國全部', codes: ['ICN', 'GMP', 'PUS', 'CJU', 'TAE'] },
  { name: '日韓主要', codes: ['NRT', 'HND', 'KIX', 'NGO', 'ICN', 'GMP'] },
  { name: '港澳', codes: ['HKG', 'MFM'] },
  { name: '東南亞', codes: ['SIN', 'BKK', 'KUL', 'MNL', 'CGK', 'SGN'] },
  { name: '紐西蘭', codes: ['AKL', 'WLG', 'CHC', 'ZQN', 'DUD'] },
  { name: '紐西蘭南島', codes: ['CHC', 'ZQN', 'DUD', 'NSN'] },
  { name: '紐西蘭北島', codes: ['AKL', 'WLG', 'ROT'] },
  { name: '澳洲', codes: ['SYD', 'MEL', 'BNE', 'PER'] },
];

// === Helpers ===

export const AIRPORT_MAP: Record<string, Airport> = Object.fromEntries(
  AIRPORTS.map((a) => [a.code, a])
);

export function getAirport(code: string): Airport | undefined {
  return AIRPORT_MAP[code];
}

/** 把機場依國家分組,按 COUNTRY_ORDER 排序 */
export function groupByCountry(): { country: string; countryZh: string; airports: Airport[] }[] {
  const groups: Record<string, Airport[]> = {};
  for (const a of AIRPORTS) {
    if (!groups[a.country]) groups[a.country] = [];
    groups[a.country].push(a);
  }
  return COUNTRY_ORDER
    .filter((c) => groups[c])
    .map((c) => ({
      country: c,
      countryZh: groups[c][0].countryZh,
      airports: groups[c],
    }));
}

/** 簡單搜尋:支援 code(NRT)、中文(成田)、英文(narita)、國家(日本) */
export function searchAirports(query: string): Airport[] {
  const q = query.trim().toLowerCase();
  if (!q) return AIRPORTS;
  return AIRPORTS.filter((a) =>
    a.code.toLowerCase().includes(q) ||
    a.zhName.includes(q) ||
    a.enName.toLowerCase().includes(q) ||
    a.countryZh.includes(q) ||
    a.country.toLowerCase().includes(q)
  );
}
