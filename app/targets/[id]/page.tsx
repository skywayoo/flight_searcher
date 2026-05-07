import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFlightTarget, getFlightResults } from '@/lib/notion';
import { REGIONS, getAirportByCode } from '@/lib/regions';
import { TargetActions } from './actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TRIP_TYPE_LABEL: Record<string, string> = {
  round_trip: '來回',
  one_way: '單程',
  multi_city_4: '外站四段',
};

function fmt(n: number) {
  return n.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
}

export default async function TargetDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const target = await getFlightTarget(id);
  if (!target) notFound();

  const results = await getFlightResults(id, 90);
  const latest = results[0];

  return (
    <div>
      <header className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/" className="text-sm text-gray-400">← 返回</Link>
          <h1 className="text-base font-semibold truncate flex-1 text-center px-2">{target.name}</h1>
          <div className="w-10" />
        </div>
      </header>

      <main className="p-4 space-y-3">
        {/* Target info */}
        <div className="rounded-xl bg-gray-900 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-block rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">
              {TRIP_TYPE_LABEL[target.tripType]}
            </span>
            <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
              target.status === 'active' ? 'bg-green-900/40 text-green-300' : 'bg-gray-700 text-gray-400'
            }`}>
              {target.status === 'active' ? '啟用中' : '已暫停'}
            </span>
          </div>
          <p className="text-sm text-gray-300">
            {target.departureAirport} → {target.region}
            {target.destinationAirports.length > 0 && (
              <span className="text-gray-500"> ({target.destinationAirports.join('/')})</span>
            )}
          </p>
          <p className="text-xs text-gray-500">
            出發日：{target.outboundStart} ~ {target.outboundEnd}
            {target.tripLengthMin && ` · 行程 ${target.tripLengthMin}-${target.tripLengthMax} 天`}
          </p>
          {target.budgetCap && (
            <p className="text-xs text-gray-500">預算上限：${fmt(target.budgetCap)}</p>
          )}
          <p className="text-xs text-gray-500">
            上次掃描：{target.lastScrapeAt || '尚未'}
          </p>
        </div>

        <TargetActions targetId={target.id} status={target.status} />

        {/* Latest result */}
        {latest && latest.top5.length > 0 ? (
          <>
            <div className="rounded-xl bg-gray-900 p-4">
              <p className="text-xs text-gray-400 mb-1">最新最低價（{latest.scrapeDate}）</p>
              <p className="text-3xl font-bold text-white">${fmt(latest.cheapestPrice)}</p>
              {latest.changePct !== undefined && Math.abs(latest.changePct) > 0.001 && (
                <p className={`text-sm mt-1 ${latest.changePct < 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {latest.changePct > 0 ? '↑' : '↓'} {(Math.abs(latest.changePct) * 100).toFixed(1)}%
                  {latest.prevCheapestPrice && (
                    <span className="text-gray-500 ml-2">(上次 ${fmt(latest.prevCheapestPrice)})</span>
                  )}
                </p>
              )}
            </div>

            {/* Top combinations */}
            {(['economy', 'business'] as const).map((cabin) => {
              const items = latest.top5.filter((c) => (c.cabin ?? 'economy') === cabin);
              if (items.length === 0) return null;
              return (
                <div key={cabin} className="space-y-3">
                  <h2 className="text-sm font-semibold text-gray-300 pt-2">
                    {cabin === 'economy' ? '經濟艙' : '商務艙'}前 {items.length} 名
                  </h2>
                  {items.map((c, i) => {
                    const airportInfo = getAirportByCode(c.outboundAirport);
                    return (
                      <div key={`${cabin}-${i}`} className="rounded-xl bg-gray-900 p-4 space-y-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                cabin === 'business' ? 'bg-purple-900/40 text-purple-300' : 'bg-orange-900/40 text-orange-300'
                              }`}>
                                #{i + 1}
                              </span>
                              <p className="text-sm font-semibold text-white">
                                {target.departureAirport} → {c.outboundAirport}
                                {airportInfo && <span className="text-gray-500 ml-1">{airportInfo.city}</span>}
                              </p>
                            </div>
                            {c.outStation && (
                              <p className="text-xs text-purple-400 mt-0.5">外站起點：{c.outStation}</p>
                            )}
                            <p className="text-xs text-gray-500 mt-0.5">
                              {c.outboundDate}{c.returnDate && ` ~ ${c.returnDate}`}
                            </p>
                            <p className="text-xs text-gray-500">
                              {c.airline} · 平日 {c.weekdayDays} 天
                            </p>
                          </div>
                          <p className="text-lg font-bold text-white">${fmt(c.totalPrice)}</p>
                        </div>
                        {(c.bookingUrls?.eztravel || c.bookingUrl) && (
                          <a
                            href={c.bookingUrls?.eztravel || c.bookingUrl}
                            target="_blank"
                            rel="noopener"
                            className="block text-center rounded-lg bg-green-600/20 border border-green-600/40 py-1.5 text-xs text-green-300 hover:bg-green-600/30"
                          >
                            到易遊網訂購 →
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </>
        ) : (
          <div className="rounded-xl bg-gray-900 p-8 text-center text-gray-500 text-sm">
            還沒有結果。點上方「立即掃描」開始。
          </div>
        )}

        {/* Price history */}
        {results.length > 1 && (
          <>
            <h2 className="text-sm font-semibold text-gray-300 pt-2">歷史最低價</h2>
            <div className="rounded-xl bg-gray-900 p-4 space-y-1.5">
              {results.slice(0, 30).map((r) => (
                <div key={r.id} className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">{r.scrapeDate}</span>
                  <span className="text-white font-medium">${fmt(r.cheapestPrice)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
