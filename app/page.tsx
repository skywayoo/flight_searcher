import Link from 'next/link';
import { getFlightTargets, getFlightResults } from '@/lib/notion';
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
  const targets = await getFlightTargets();

  // Get latest valid result (cheapestPrice > 0) for each target
  const latestByTarget: Record<string, { price: number; date: string; changePct?: number } | null> = {};
  for (const t of targets) {
    const results = await getFlightResults(t.id, 5);
    const valid = results.find((r) => r.cheapestPrice > 0);
    latestByTarget[t.id] = valid
      ? { price: valid.cheapestPrice, date: valid.scrapeDate, changePct: valid.changePct }
      : null;
  }

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
        {targets.length === 0 ? (
          <div className="rounded-xl bg-gray-900 p-12 text-center text-gray-500">
            還沒有監控目標，點右上角「新增目標」開始 ✈️
          </div>
        ) : (
          targets.map((t) => {
            const latest = latestByTarget[t.id];
            const regionLabel = REGIONS[t.region]?.label || t.region;
            const isPaused = t.status === 'paused';
            return (
              <Link
                key={t.id}
                href={`/targets/${t.id}`}
                className={`block rounded-xl bg-gray-900 p-4 hover:bg-gray-800 transition-colors ${isPaused ? 'opacity-50' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-white truncate">{t.name}</p>
                      <span className="shrink-0 inline-block rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">
                        {TRIP_TYPE_LABEL[t.tripType]}
                      </span>
                      {isPaused && (
                        <span className="shrink-0 inline-block rounded bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400">
                          已暫停
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">
                      {t.departureAirport} → {regionLabel}
                      {t.destinationAirports.length > 0 && (
                        <span className="text-gray-500"> ({t.destinationAirports.join('/')})</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t.outboundStart} ~ {t.outboundEnd}
                      {t.tripLengthMin && ` · ${t.tripLengthMin}-${t.tripLengthMax}天`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {latest ? (
                      <>
                        <p className="text-lg font-bold text-white">${fmt(latest.price)}</p>
                        {latest.changePct !== undefined && Math.abs(latest.changePct) > 0.001 && (
                          <p className={`text-xs ${latest.changePct < 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {latest.changePct > 0 ? '+' : ''}{(latest.changePct * 100).toFixed(1)}%
                          </p>
                        )}
                        <p className="text-xs text-gray-500 mt-0.5">{latest.date}</p>
                      </>
                    ) : (
                      <p className="text-xs text-gray-500">未掃描</p>
                    )}
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </main>
    </div>
  );
}
