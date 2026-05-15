import Link from 'next/link';
import { getFlightTargets, getAllResultsLatest } from '@/lib/notion';
import { REGIONS } from '@/lib/regions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TRIP_TYPE_LABEL: Record<string, string> = {
  round_trip: '來回',
  one_way: '單程',
  multi_city_4: '四段票',
};

function fmt(n: number) {
  return n.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
}

export default async function Home() {
  // Single batch: fetch all targets + all latest results in two queries
  const [targets, latestByTarget] = await Promise.all([
    getFlightTargets(),
    getAllResultsLatest(),
  ]);

  // Sort targets: hits first (by cheapest price asc), then non-hits
  const enriched = targets.map((t) => ({
    target: t,
    latest: latestByTarget[t.id] ?? null,
  }));
  enriched.sort((a, b) => {
    const aHas = a.latest && a.latest.price > 0 ? 1 : 0;
    const bHas = b.latest && b.latest.price > 0 ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    if (aHas) return (a.latest!.price) - (b.latest!.price);
    return a.target.name.localeCompare(b.target.name);
  });

  const hits = enriched.filter((e) => e.latest && e.latest.price > 0);
  const noHits = enriched.filter((e) => !e.latest || e.latest.price === 0);

  return (
    <div>
      <header className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-lg font-semibold">機票監控</h1>
          <Link
            href="/targets/new"
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            + 新增目標
          </Link>
        </div>
      </header>

      <main className="p-4 space-y-3">
        <div className="text-xs text-gray-500">
          共 {targets.length} 目標 · 已掃到 {hits.length} 筆 · {noHits.length} 待掃/超預算
        </div>

        {targets.length === 0 ? (
          <div className="rounded-xl bg-gray-900 p-12 text-center text-gray-500">
            還沒有監控目標 ✈️
          </div>
        ) : (
          <>
            {hits.length > 0 && (
              <h2 className="text-sm font-semibold text-green-400 pt-2">已找到航班（按價格）</h2>
            )}
            {hits.map(({ target: t, latest }) => (
              <TargetCard key={t.id} target={t} latest={latest!} />
            ))}

            {noHits.length > 0 && (
              <details className="pt-4">
                <summary className="text-xs text-gray-500 cursor-pointer">
                  其他 {noHits.length} 個目標（未找到航班 / 超預算）
                </summary>
                <div className="mt-2 space-y-2">
                  {noHits.slice(0, 100).map(({ target: t }) => (
                    <Link
                      key={t.id}
                      href={`/targets/${t.id}`}
                      className="block rounded-lg bg-gray-900/50 p-2 text-xs text-gray-400 hover:bg-gray-800"
                    >
                      {t.name} · {t.departureAirport}→{REGIONS[t.region]?.label || t.region}
                    </Link>
                  ))}
                  {noHits.length > 100 && (
                    <p className="text-xs text-gray-600 text-center">...還有 {noHits.length - 100} 個</p>
                  )}
                </div>
              </details>
            )}
          </>
        )}
      </main>
    </div>
  );
}

type SegSpec = { from: string; to: string; date: string; dateEnd?: string };

function segLine(segs: SegSpec[] | undefined): string | null {
  if (!segs || segs.length === 0) return null;
  const fmtAirports = (codes: string) => {
    const list = (codes || '').split(',').map((c) => c.trim()).filter(Boolean);
    if (list.length <= 3) return list.join('/');
    return list.slice(0, 3).join('/') + '+' + (list.length - 3);
  };
  return segs
    .map((s, i) => `${i + 1}.${fmtAirports(s.from)}→${fmtAirports(s.to)} ${(s.date || '').slice(5)}`)
    .join('  ');
}

function compactRoute(t: { segments?: SegSpec[] }, latest: { out1?: string; out4?: string }): string | null {
  // Prefer the actual hit's route (ICN-ZQN-TPE-ICN style).
  if (latest.out1 && latest.out4 && t.segments?.length === 4) {
    const nzOut = t.segments[1].to.split(',')[0];
    const nzIn = t.segments[2].from.split(',')[0];
    return `${latest.out1}-${nzOut}-${nzIn === nzOut ? '' : nzIn + '-'}TPE-${latest.out4}`.replace('--', '-');
  }
  // No hit yet — give a structural preview from the target's segments.
  if (t.segments?.length === 4) {
    const f = (s: string) => (s || '').split(',')[0];
    return `${f(t.segments[0].from)}-${f(t.segments[1].to)}-${f(t.segments[2].from)}-${f(t.segments[3].to)}`;
  }
  return null;
}

function TargetCard({
  target: t,
  latest,
}: {
  target: { id: string; name: string; tripType: string; departureAirport: string; region: string; destinationAirports: string[]; segments?: SegSpec[]; outboundStart: string; outboundEnd: string; tripLengthMin?: number; tripLengthMax?: number; status: string };
  latest: { price: number; date: string; changePct?: number; out1?: string; out4?: string; airline?: string; bookingUrl?: string };
}) {
  const regionLabel = REGIONS[t.region]?.label || t.region;
  const isPaused = t.status === 'paused';
  const isMulti = t.tripType === 'multi_city_4';
  const compact = isMulti ? compactRoute(t, latest) : null;
  const seg = isMulti ? segLine(t.segments) : null;
  return (
    <Link
      href={`/targets/${t.id}`}
      className={`block rounded-xl bg-gray-900 p-4 hover:bg-gray-800 transition-colors ${isPaused ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {compact ? (
              <p className="font-semibold text-white font-mono">{compact}</p>
            ) : (
              <p className="font-semibold text-white truncate">{t.name}</p>
            )}
            <span className="shrink-0 inline-block rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">
              {TRIP_TYPE_LABEL[t.tripType]}
            </span>
            {latest.airline && (
              <span className="shrink-0 inline-block rounded bg-orange-900/30 px-1.5 py-0.5 text-[10px] text-orange-300">
                {latest.airline}
              </span>
            )}
          </div>
          {compact && (
            <p className="text-[10px] text-gray-600 mb-1">{t.name}</p>
          )}
          {seg ? (
            <p className="text-[11px] text-gray-400 leading-snug break-words font-mono">{seg}</p>
          ) : (
            <p className="text-xs text-gray-400">
              {t.departureAirport} → {regionLabel}
              {t.destinationAirports.length > 0 && (
                <span className="text-gray-500"> ({t.destinationAirports.join('/')})</span>
              )}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-bold text-white">${fmt(latest.price)}</p>
          {latest.changePct !== undefined && Math.abs(latest.changePct) > 0.001 && (
            <p className={`text-xs ${latest.changePct < 0 ? 'text-green-400' : 'text-red-400'}`}>
              {latest.changePct > 0 ? '+' : ''}{(latest.changePct * 100).toFixed(1)}%
            </p>
          )}
          <p className="text-xs text-gray-500 mt-0.5">{latest.date}</p>
        </div>
      </div>
    </Link>
  );
}
