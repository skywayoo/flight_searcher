// 機場代碼 + 中文名（IATA code → display name）
export interface Airport {
  code: string;
  city: string;       // 中文城市名
  country: string;    // 中文國家名
}

// 各區域對應的主要機場
export const REGIONS: Record<string, { label: string; airports: Airport[] }> = {
  日本: {
    label: '日本',
    airports: [
      { code: 'NRT', city: '東京（成田）', country: '日本' },
      { code: 'HND', city: '東京（羽田）', country: '日本' },
      { code: 'KIX', city: '大阪', country: '日本' },
      { code: 'NGO', city: '名古屋', country: '日本' },
      { code: 'FUK', city: '福岡', country: '日本' },
      { code: 'CTS', city: '札幌', country: '日本' },
      { code: 'OKA', city: '沖繩', country: '日本' },
      { code: 'KMJ', city: '熊本', country: '日本' },
      { code: 'HIJ', city: '廣島', country: '日本' },
      { code: 'TAK', city: '高松', country: '日本' },
    ],
  },
  韓國: {
    label: '韓國',
    airports: [
      { code: 'ICN', city: '首爾（仁川）', country: '韓國' },
      { code: 'GMP', city: '首爾（金浦）', country: '韓國' },
      { code: 'PUS', city: '釜山', country: '韓國' },
      { code: 'CJU', city: '濟州', country: '韓國' },
      { code: 'TAE', city: '大邱', country: '韓國' },
    ],
  },
  港澳: {
    label: '港澳',
    airports: [
      { code: 'HKG', city: '香港', country: '香港' },
      { code: 'MFM', city: '澳門', country: '澳門' },
    ],
  },
  東北亞: {
    label: '東北亞',
    airports: [], // computed: 日本 + 韓國 + 港澳
  },

  泰國: {
    label: '泰國',
    airports: [
      { code: 'BKK', city: '曼谷（蘇凡納布）', country: '泰國' },
      { code: 'DMK', city: '曼谷（廊曼）', country: '泰國' },
      { code: 'HKT', city: '普吉', country: '泰國' },
      { code: 'CNX', city: '清邁', country: '泰國' },
      { code: 'USM', city: '蘇梅島', country: '泰國' },
      { code: 'KBV', city: '喀比', country: '泰國' },
    ],
  },
  越南: {
    label: '越南',
    airports: [
      { code: 'SGN', city: '胡志明市', country: '越南' },
      { code: 'HAN', city: '河內', country: '越南' },
      { code: 'DAD', city: '峴港', country: '越南' },
      { code: 'CXR', city: '芽莊', country: '越南' },
      { code: 'PQC', city: '富國島', country: '越南' },
    ],
  },
  新加坡: {
    label: '新加坡',
    airports: [{ code: 'SIN', city: '新加坡', country: '新加坡' }],
  },
  馬來西亞: {
    label: '馬來西亞',
    airports: [
      { code: 'KUL', city: '吉隆坡', country: '馬來西亞' },
      { code: 'PEN', city: '檳城', country: '馬來西亞' },
      { code: 'BKI', city: '亞庇', country: '馬來西亞' },
      { code: 'KCH', city: '古晉', country: '馬來西亞' },
    ],
  },
  印尼: {
    label: '印尼',
    airports: [
      { code: 'CGK', city: '雅加達', country: '印尼' },
      { code: 'DPS', city: '峇里島', country: '印尼' },
      { code: 'SUB', city: '泗水', country: '印尼' },
    ],
  },
  菲律賓: {
    label: '菲律賓',
    airports: [
      { code: 'MNL', city: '馬尼拉', country: '菲律賓' },
      { code: 'CEB', city: '宿霧', country: '菲律賓' },
      { code: 'CRK', city: '克拉克', country: '菲律賓' },
      { code: 'KLO', city: '長灘島（卡利博）', country: '菲律賓' },
    ],
  },
  柬寮緬: {
    label: '柬寮緬',
    airports: [
      { code: 'PNH', city: '金邊', country: '柬埔寨' },
      { code: 'REP', city: '暹粒', country: '柬埔寨' },
      { code: 'VTE', city: '永珍', country: '寮國' },
      { code: 'RGN', city: '仰光', country: '緬甸' },
    ],
  },
  東南亞: {
    label: '東南亞',
    airports: [], // computed
  },

  南亞: {
    label: '南亞',
    airports: [
      { code: 'DEL', city: '德里', country: '印度' },
      { code: 'BOM', city: '孟買', country: '印度' },
      { code: 'BLR', city: '邦加羅爾', country: '印度' },
      { code: 'MAA', city: '清奈', country: '印度' },
      { code: 'MLE', city: '馬列', country: '馬爾地夫' },
      { code: 'KTM', city: '加德滿都', country: '尼泊爾' },
      { code: 'CMB', city: '可倫坡', country: '斯里蘭卡' },
    ],
  },

  紐澳: {
    label: '紐澳',
    airports: [
      { code: 'SYD', city: '雪梨', country: '澳洲' },
      { code: 'MEL', city: '墨爾本', country: '澳洲' },
      { code: 'BNE', city: '布里斯本', country: '澳洲' },
      { code: 'PER', city: '伯斯', country: '澳洲' },
      { code: 'AKL', city: '奧克蘭', country: '紐西蘭' },
      { code: 'CHC', city: '基督城', country: '紐西蘭' },
    ],
  },

  美西: {
    label: '美西',
    airports: [
      { code: 'LAX', city: '洛杉磯', country: '美國' },
      { code: 'SFO', city: '舊金山', country: '美國' },
      { code: 'SEA', city: '西雅圖', country: '美國' },
      { code: 'SAN', city: '聖地牙哥', country: '美國' },
      { code: 'LAS', city: '拉斯維加斯', country: '美國' },
      { code: 'PDX', city: '波特蘭', country: '美國' },
      { code: 'HNL', city: '檀香山', country: '美國' },
    ],
  },
  美東: {
    label: '美東',
    airports: [
      { code: 'JFK', city: '紐約（甘迺迪）', country: '美國' },
      { code: 'EWR', city: '紐約（紐華克）', country: '美國' },
      { code: 'LGA', city: '紐約（拉瓜地亞）', country: '美國' },
      { code: 'BOS', city: '波士頓', country: '美國' },
      { code: 'IAD', city: '華盛頓', country: '美國' },
      { code: 'MIA', city: '邁阿密', country: '美國' },
      { code: 'ATL', city: '亞特蘭大', country: '美國' },
      { code: 'ORD', city: '芝加哥', country: '美國' },
    ],
  },
  加拿大: {
    label: '加拿大',
    airports: [
      { code: 'YVR', city: '溫哥華', country: '加拿大' },
      { code: 'YYZ', city: '多倫多', country: '加拿大' },
      { code: 'YUL', city: '蒙特婁', country: '加拿大' },
      { code: 'YYC', city: '卡加利', country: '加拿大' },
    ],
  },
  北美: {
    label: '北美',
    airports: [], // computed
  },

  西歐: {
    label: '西歐',
    airports: [
      { code: 'LHR', city: '倫敦（希斯洛）', country: '英國' },
      { code: 'LGW', city: '倫敦（蓋威克）', country: '英國' },
      { code: 'CDG', city: '巴黎（戴高樂）', country: '法國' },
      { code: 'ORY', city: '巴黎（奧利）', country: '法國' },
      { code: 'AMS', city: '阿姆斯特丹', country: '荷蘭' },
      { code: 'BRU', city: '布魯塞爾', country: '比利時' },
      { code: 'DUB', city: '都柏林', country: '愛爾蘭' },
    ],
  },
  中歐: {
    label: '中歐',
    airports: [
      { code: 'FRA', city: '法蘭克福', country: '德國' },
      { code: 'MUC', city: '慕尼黑', country: '德國' },
      { code: 'BER', city: '柏林', country: '德國' },
      { code: 'VIE', city: '維也納', country: '奧地利' },
      { code: 'ZRH', city: '蘇黎世', country: '瑞士' },
      { code: 'PRG', city: '布拉格', country: '捷克' },
      { code: 'BUD', city: '布達佩斯', country: '匈牙利' },
      { code: 'WAW', city: '華沙', country: '波蘭' },
    ],
  },
  南歐: {
    label: '南歐',
    airports: [
      { code: 'FCO', city: '羅馬', country: '義大利' },
      { code: 'MXP', city: '米蘭', country: '義大利' },
      { code: 'VCE', city: '威尼斯', country: '義大利' },
      { code: 'BCN', city: '巴塞隆納', country: '西班牙' },
      { code: 'MAD', city: '馬德里', country: '西班牙' },
      { code: 'LIS', city: '里斯本', country: '葡萄牙' },
      { code: 'ATH', city: '雅典', country: '希臘' },
    ],
  },
  北歐: {
    label: '北歐',
    airports: [
      { code: 'CPH', city: '哥本哈根', country: '丹麥' },
      { code: 'ARN', city: '斯德哥爾摩', country: '瑞典' },
      { code: 'OSL', city: '奧斯陸', country: '挪威' },
      { code: 'HEL', city: '赫爾辛基', country: '芬蘭' },
      { code: 'KEF', city: '雷克雅維克', country: '冰島' },
    ],
  },
  歐洲: {
    label: '歐洲',
    airports: [], // computed
  },

  中東: {
    label: '中東',
    airports: [
      { code: 'DXB', city: '杜拜', country: '阿聯' },
      { code: 'AUH', city: '阿布達比', country: '阿聯' },
      { code: 'DOH', city: '多哈', country: '卡達' },
      { code: 'IST', city: '伊斯坦堡', country: '土耳其' },
      { code: 'TLV', city: '特拉維夫', country: '以色列' },
      { code: 'AMM', city: '安曼', country: '約旦' },
    ],
  },

  中南美: {
    label: '中南美',
    airports: [
      { code: 'MEX', city: '墨西哥城', country: '墨西哥' },
      { code: 'CUN', city: '坎昆', country: '墨西哥' },
      { code: 'GRU', city: '聖保羅', country: '巴西' },
      { code: 'GIG', city: '里約', country: '巴西' },
      { code: 'EZE', city: '布宜諾斯艾利斯', country: '阿根廷' },
      { code: 'SCL', city: '聖地牙哥', country: '智利' },
      { code: 'LIM', city: '利馬', country: '秘魯' },
    ],
  },

  非洲: {
    label: '非洲',
    airports: [
      { code: 'CAI', city: '開羅', country: '埃及' },
      { code: 'JNB', city: '約翰尼斯堡', country: '南非' },
      { code: 'CPT', city: '開普敦', country: '南非' },
      { code: 'NBO', city: '奈洛比', country: '肯亞' },
      { code: 'CMN', city: '卡薩布蘭加', country: '摩洛哥' },
    ],
  },
};

// Aggregate sub-regions
REGIONS.東北亞.airports = [
  ...REGIONS.日本.airports,
  ...REGIONS.韓國.airports,
  ...REGIONS.港澳.airports,
];
REGIONS.東南亞.airports = [
  ...REGIONS.泰國.airports,
  ...REGIONS.越南.airports,
  ...REGIONS.新加坡.airports,
  ...REGIONS.馬來西亞.airports,
  ...REGIONS.印尼.airports,
  ...REGIONS.菲律賓.airports,
  ...REGIONS.柬寮緬.airports,
];
REGIONS.北美.airports = [
  ...REGIONS.美西.airports,
  ...REGIONS.美東.airports,
  ...REGIONS.加拿大.airports,
];
REGIONS.歐洲.airports = [
  ...REGIONS.西歐.airports,
  ...REGIONS.中歐.airports,
  ...REGIONS.南歐.airports,
  ...REGIONS.北歐.airports,
];

// 出發地（台灣）
export const DEPARTURE_AIRPORTS: Airport[] = [
  { code: 'TPE', city: '桃園', country: '台灣' },
  { code: 'TSA', city: '松山', country: '台灣' },
  { code: 'KHH', city: '高雄', country: '台灣' },
  { code: 'RMQ', city: '台中', country: '台灣' },
  { code: 'TNN', city: '台南', country: '台灣' },
];

// 外站起點（四段票）— 常見便宜外站
export const OUT_STATIONS: Airport[] = [
  { code: 'HKG', city: '香港', country: '香港' },
  { code: 'BKK', city: '曼谷', country: '泰國' },
  { code: 'ICN', city: '首爾', country: '韓國' },
  { code: 'KUL', city: '吉隆坡', country: '馬來西亞' },
  { code: 'SIN', city: '新加坡', country: '新加坡' },
  { code: 'NRT', city: '東京', country: '日本' },
  { code: 'MNL', city: '馬尼拉', country: '菲律賓' },
];

export function getRegionAirports(regionKey: string): Airport[] {
  return REGIONS[regionKey]?.airports ?? [];
}

export function getAirportByCode(code: string): Airport | undefined {
  for (const region of Object.values(REGIONS)) {
    const found = region.airports.find((a) => a.code === code);
    if (found) return found;
  }
  return DEPARTURE_AIRPORTS.find((a) => a.code === code);
}

export const REGION_KEYS = [
  '日本', '韓國', '港澳', '東北亞',
  '泰國', '越南', '新加坡', '馬來西亞', '印尼', '菲律賓', '柬寮緬', '東南亞',
  '南亞', '紐澳',
  '美西', '美東', '加拿大', '北美',
  '西歐', '中歐', '南歐', '北歐', '歐洲',
  '中東', '中南美', '非洲',
] as const;

export type RegionKey = typeof REGION_KEYS[number];
