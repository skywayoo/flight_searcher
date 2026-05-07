import { FlightTarget, FlightResult, FlightCombination } from '@/types';

const DB = {
  get TARGETS() { return (process.env.NOTION_FLIGHT_TARGETS_DB_ID ?? '').trim(); },
  get RESULTS() { return (process.env.NOTION_FLIGHT_RESULTS_DB_ID ?? '').trim(); },
};

const HEADERS = () => ({
  'Authorization': `Bearer ${process.env.NOTION_API_KEY}`,
  'Content-Type': 'application/json',
  'Notion-Version': '2022-06-28',
});

async function queryDB(dbId: string, body: Record<string, unknown> = {}): Promise<{ results: Record<string, unknown>[] }> {
  const all: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  do {
    const reqBody = { ...body, ...(cursor ? { start_cursor: cursor } : {}) };
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST', headers: HEADERS(), body: JSON.stringify(reqBody),
    });
    const data = await res.json() as { results?: Record<string, unknown>[]; has_more?: boolean; next_cursor?: string };
    if (data.results) all.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return { results: all };
}

async function createPage(dbId: string, properties: Record<string, unknown>): Promise<string> {
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST', headers: HEADERS(),
    body: JSON.stringify({ parent: { database_id: dbId }, properties }),
  });
  const text = await res.text();
  const d = JSON.parse(text) as { id?: string; message?: string };
  if (!d.id) throw new Error(`Notion createPage failed: ${d.message ?? text.slice(0, 200)}`);
  return d.id;
}

async function updatePage(pageId: string, body: Record<string, unknown>): Promise<void> {
  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH', headers: HEADERS(), body: JSON.stringify(body),
  });
}

// ============ Helpers ============
function getTitle(p: Record<string, unknown>): string {
  const props = p as { properties: Record<string, { type?: string; title?: { plain_text: string }[] }> };
  const titleProp = Object.values(props.properties).find((v) => v.type === 'title');
  return titleProp?.title?.[0]?.plain_text ?? '';
}
function getRich(p: Record<string, unknown>, key: string): string {
  const props = p as { properties: Record<string, { rich_text?: { plain_text: string }[] }> };
  return props.properties[key]?.rich_text?.[0]?.plain_text ?? '';
}
function getNum(p: Record<string, unknown>, key: string): number {
  const props = p as { properties: Record<string, { number?: number | null }> };
  return props.properties[key]?.number ?? 0;
}
function getDate(p: Record<string, unknown>, key: string): string {
  const props = p as { properties: Record<string, { date?: { start?: string } | null }> };
  return props.properties[key]?.date?.start ?? '';
}
function getSelect(p: Record<string, unknown>, key: string): string {
  const props = p as { properties: Record<string, { select?: { name: string } | null }> };
  return props.properties[key]?.select?.name ?? '';
}
function getMultiSelect(p: Record<string, unknown>, key: string): string[] {
  const props = p as { properties: Record<string, { multi_select?: { name: string }[] }> };
  return props.properties[key]?.multi_select?.map((x) => x.name) ?? [];
}
function pid(p: Record<string, unknown>): string {
  return (p as { id: string }).id;
}

// ============ Flight Targets ============
export async function getFlightTargets(): Promise<FlightTarget[]> {
  const r = await queryDB(DB.TARGETS, { sorts: [{ property: 'CreatedAt', direction: 'descending' }] });
  return r.results.map(rowToTarget);
}

export async function getFlightTarget(id: string): Promise<FlightTarget | null> {
  const res = await fetch(`https://api.notion.com/v1/pages/${id}`, { headers: HEADERS() });
  const data = await res.json();
  if (!data.id) return null;
  return rowToTarget(data);
}

function getBool(p: Record<string, unknown>, key: string): boolean {
  const props = p as { properties: Record<string, { checkbox?: boolean }> };
  return props.properties[key]?.checkbox ?? false;
}

function rowToTarget(p: Record<string, unknown>): FlightTarget {
  let outStations: string[] = [];
  try {
    const raw = getRich(p, 'OutStations');
    if (raw) outStations = JSON.parse(raw);
  } catch { /* ignore */ }
  let segments: FlightTarget['segments'];
  try {
    const raw = getRich(p, 'Segments');
    if (raw) segments = JSON.parse(raw);
  } catch { /* ignore */ }
  return {
    id: pid(p),
    name: getTitle(p),
    tripType: (getSelect(p, 'TripType') || 'round_trip') as FlightTarget['tripType'],
    departureAirport: getRich(p, 'DepartureAirport') || 'TPE',
    region: getSelect(p, 'Region'),
    destinationAirports: getMultiSelect(p, 'DestinationAirports'),
    outboundStart: getDate(p, 'OutboundStart'),
    outboundEnd: getDate(p, 'OutboundEnd'),
    tripLengthMin: getNum(p, 'TripLengthMin') || undefined,
    tripLengthMax: getNum(p, 'TripLengthMax') || undefined,
    segments,
    outStations: outStations.length ? outStations : undefined,
    budgetCap: getNum(p, 'BudgetCap') || undefined,
    includeBusiness: getBool(p, 'IncludeBusiness'),
    notifyDropPct: getNum(p, 'NotifyDropPct') || undefined,
    status: (getSelect(p, 'Status') || 'active') as FlightTarget['status'],
    createdAt: getDate(p, 'CreatedAt'),
    lastScrapeAt: getDate(p, 'LastScrapeAt') || undefined,
  };
}

export async function createFlightTarget(t: Omit<FlightTarget, 'id' | 'createdAt'>): Promise<string> {
  const props: Record<string, unknown> = {
    Name: { title: [{ text: { content: t.name } }] },
    TripType: { select: { name: t.tripType } },
    DepartureAirport: { rich_text: [{ text: { content: t.departureAirport } }] },
    Region: { select: { name: t.region } },
    DestinationAirports: { multi_select: t.destinationAirports.map((c) => ({ name: c })) },
    OutboundStart: { date: { start: t.outboundStart } },
    OutboundEnd: { date: { start: t.outboundEnd } },
    Status: { select: { name: t.status } },
    CreatedAt: { date: { start: new Date().toISOString().split('T')[0] } },
  };
  if (t.tripLengthMin) props.TripLengthMin = { number: t.tripLengthMin };
  if (t.tripLengthMax) props.TripLengthMax = { number: t.tripLengthMax };
  if (t.segments?.length) props.Segments = { rich_text: [{ text: { content: JSON.stringify(t.segments) } }] };
  if (t.outStations?.length) props.OutStations = { rich_text: [{ text: { content: JSON.stringify(t.outStations) } }] };
  if (t.budgetCap) props.BudgetCap = { number: t.budgetCap };
  if (t.includeBusiness) props.IncludeBusiness = { checkbox: true };
  if (t.notifyDropPct) props.NotifyDropPct = { number: t.notifyDropPct };
  return createPage(DB.TARGETS, props);
}

export async function updateFlightTarget(id: string, data: Partial<FlightTarget>): Promise<void> {
  const props: Record<string, unknown> = {};
  if (data.name) props.Name = { title: [{ text: { content: data.name } }] };
  if (data.status) props.Status = { select: { name: data.status } };
  if (data.lastScrapeAt) props.LastScrapeAt = { date: { start: data.lastScrapeAt } };
  if (data.outboundStart) props.OutboundStart = { date: { start: data.outboundStart } };
  if (data.outboundEnd) props.OutboundEnd = { date: { start: data.outboundEnd } };
  if (data.budgetCap !== undefined) props.BudgetCap = { number: data.budgetCap };
  await updatePage(id, { properties: props });
}

export async function deleteFlightTarget(id: string): Promise<void> {
  await updatePage(id, { archived: true });
}

// ============ Flight Results ============
export async function getFlightResults(targetId: string, limit = 90): Promise<FlightResult[]> {
  const r = await queryDB(DB.RESULTS, {
    filter: { property: 'TargetId', rich_text: { equals: targetId } },
    sorts: [{ property: 'ScrapeDate', direction: 'descending' }],
    page_size: limit,
  });
  return r.results.map(rowToResult);
}

function getRichConcat(p: Record<string, unknown>, key: string): string {
  // Notion rich_text supports multiple text segments; concat all to bypass 2000-char limit
  const props = p as { properties: Record<string, { rich_text?: { plain_text: string }[] }> };
  const segs = props.properties[key]?.rich_text;
  if (!segs) return '';
  return segs.map((s) => s.plain_text).join('');
}

function rowToResult(p: Record<string, unknown>): FlightResult {
  let top5: FlightCombination[] = [];
  try {
    const raw = getRichConcat(p, 'Top5');
    if (raw) top5 = JSON.parse(raw);
  } catch { /* ignore */ }
  return {
    id: pid(p),
    targetId: getRich(p, 'TargetId'),
    scrapeDate: getDate(p, 'ScrapeDate'),
    cheapestPrice: getNum(p, 'CheapestPrice'),
    prevCheapestPrice: getNum(p, 'PrevCheapestPrice') || undefined,
    changePct: getNum(p, 'ChangePct') || undefined,
    top5,
    source: (getSelect(p, 'Source') || 'mixed') as FlightResult['source'],
    scrapeDurationMs: getNum(p, 'ScrapeDurationMs') || undefined,
  };
}

// Notion rich_text segment max is 2000 chars; we split JSON across multiple segments
function chunkText(s: string, size = 1900): { text: { content: string } }[] {
  const out: { text: { content: string } }[] = [];
  for (let i = 0; i < s.length; i += size) {
    out.push({ text: { content: s.slice(i, i + size) } });
  }
  // Notion rich_text array max is 100 items; cap to be safe
  return out.slice(0, 100);
}

export async function createFlightResult(r: Omit<FlightResult, 'id'>): Promise<string> {
  const props: Record<string, unknown> = {
    Name: { title: [{ text: { content: `${r.targetId.slice(0, 8)} ${r.scrapeDate}` } }] },
    TargetId: { rich_text: [{ text: { content: r.targetId } }] },
    ScrapeDate: { date: { start: r.scrapeDate } },
    CheapestPrice: { number: r.cheapestPrice },
    Top5: { rich_text: chunkText(JSON.stringify(r.top5)) },
    Source: { select: { name: r.source } },
  };
  if (r.prevCheapestPrice) props.PrevCheapestPrice = { number: r.prevCheapestPrice };
  if (r.changePct !== undefined) props.ChangePct = { number: r.changePct };
  if (r.scrapeDurationMs) props.ScrapeDurationMs = { number: r.scrapeDurationMs };
  return createPage(DB.RESULTS, props);
}

// ============ DB Bootstrap (one-time) ============
export async function createTargetDb(parentPageId: string): Promise<string> {
  const res = await fetch('https://api.notion.com/v1/databases', {
    method: 'POST', headers: HEADERS(),
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: 'Flight Targets' } }],
      properties: {
        Name: { title: {} },
        TripType: { select: { options: [
          { name: 'round_trip', color: 'blue' },
          { name: 'one_way', color: 'green' },
          { name: 'multi_city_4', color: 'purple' },
        ] } },
        DepartureAirport: { rich_text: {} },
        Region: { select: {} },
        DestinationAirports: { multi_select: {} },
        OutboundStart: { date: {} },
        OutboundEnd: { date: {} },
        TripLengthMin: { number: { format: 'number' } },
        TripLengthMax: { number: { format: 'number' } },
        OutStations: { rich_text: {} },
        BudgetCap: { number: { format: 'number_with_commas' } },
        NotifyDropPct: { number: { format: 'number' } },
        Status: { select: { options: [
          { name: 'active', color: 'green' },
          { name: 'paused', color: 'gray' },
        ] } },
        CreatedAt: { date: {} },
        LastScrapeAt: { date: {} },
      },
    }),
  });
  const data = await res.json();
  if (!data.id) throw new Error(`createTargetDb failed: ${JSON.stringify(data).slice(0, 300)}`);
  return data.id;
}

export async function createResultDb(parentPageId: string): Promise<string> {
  const res = await fetch('https://api.notion.com/v1/databases', {
    method: 'POST', headers: HEADERS(),
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: 'Flight Results' } }],
      properties: {
        Name: { title: {} },
        TargetId: { rich_text: {} },
        ScrapeDate: { date: {} },
        CheapestPrice: { number: { format: 'number_with_commas' } },
        PrevCheapestPrice: { number: { format: 'number_with_commas' } },
        ChangePct: { number: { format: 'percent' } },
        Top5: { rich_text: {} },
        Source: { select: { options: [
          { name: 'trip.com', color: 'blue' },
          { name: 'eztravel', color: 'green' },
          { name: 'mixed', color: 'gray' },
        ] } },
        ScrapeDurationMs: { number: { format: 'number' } },
      },
    }),
  });
  const data = await res.json();
  if (!data.id) throw new Error(`createResultDb failed: ${JSON.stringify(data).slice(0, 300)}`);
  return data.id;
}
