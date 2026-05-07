'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { REGIONS, REGION_KEYS, DEPARTURE_AIRPORTS } from '@/lib/regions';

export default function NewTargetPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    tripType: 'round_trip' as 'round_trip' | 'one_way' | 'multi_city_4',
    departureAirport: 'TPE',
    region: '日本',
    destinationAirports: [] as string[],
    outboundStart: '',
    outboundEnd: '',
    tripLengthMin: 5,
    tripLengthMax: 10,
    budgetCap: 0,
    notifyDropPct: 5,
  });

  const regionAirports = REGIONS[form.region]?.airports || [];

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          budgetCap: form.budgetCap || undefined,
          tripLengthMin: form.tripType === 'round_trip' ? form.tripLengthMin : undefined,
          tripLengthMax: form.tripType === 'round_trip' ? form.tripLengthMax : undefined,
          status: 'active',
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      router.push(`/targets/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失敗');
      setSubmitting(false);
    }
  }

  return (
    <div>
      <header className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/" className="text-sm text-gray-400">← 返回</Link>
          <h1 className="text-lg font-semibold">新增監控目標</h1>
          <div className="w-10" />
        </div>
      </header>

      <main className="p-4 space-y-4">
        {/* Name */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">目標名稱</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="例如：暑假東京"
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
          />
        </div>

        {/* Trip Type */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">票種</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { v: 'round_trip', label: '來回' },
              { v: 'one_way', label: '單程' },
              { v: 'multi_city_4', label: '外站四段' },
            ].map((t) => (
              <button
                key={t.v}
                onClick={() => setForm({ ...form, tripType: t.v as typeof form.tripType })}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  form.tripType === t.v ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Departure */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">出發地</label>
          <select
            value={form.departureAirport}
            onChange={(e) => setForm({ ...form, departureAirport: e.target.value })}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
          >
            {DEPARTURE_AIRPORTS.map((a) => (
              <option key={a.code} value={a.code}>{a.code} {a.city}</option>
            ))}
          </select>
        </div>

        {/* Region */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">目的地區域</label>
          <select
            value={form.region}
            onChange={(e) => setForm({ ...form, region: e.target.value, destinationAirports: [] })}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
          >
            {REGION_KEYS.map((k) => (
              <option key={k} value={k}>{k}（{REGIONS[k].airports.length} 機場）</option>
            ))}
          </select>
        </div>

        {/* Destination Airports (optional filter) */}
        {regionAirports.length > 0 && (
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              限定機場（不選=全掃 {regionAirports.length} 個）
            </label>
            <div className="flex flex-wrap gap-1.5">
              {regionAirports.map((a) => {
                const sel = form.destinationAirports.includes(a.code);
                return (
                  <button
                    key={a.code}
                    onClick={() => setForm({
                      ...form,
                      destinationAirports: sel
                        ? form.destinationAirports.filter((c) => c !== a.code)
                        : [...form.destinationAirports, a.code],
                    })}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                      sel ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'
                    }`}
                  >
                    {a.code} {a.city}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Date Range */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-400 mb-1">出發日 (起)</label>
            <input
              type="date"
              value={form.outboundStart}
              onChange={(e) => setForm({ ...form, outboundStart: e.target.value })}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">出發日 (止)</label>
            <input
              type="date"
              value={form.outboundEnd}
              onChange={(e) => setForm({ ...form, outboundEnd: e.target.value })}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
            />
          </div>
        </div>

        {/* Trip Length (round trip only) */}
        {form.tripType === 'round_trip' && (
          <div>
            <label className="block text-xs text-gray-400 mb-1">行程長度（天）</label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                value={form.tripLengthMin}
                onChange={(e) => setForm({ ...form, tripLengthMin: parseInt(e.target.value) || 0 })}
                placeholder="最少"
                className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
              />
              <input
                type="number"
                value={form.tripLengthMax}
                onChange={(e) => setForm({ ...form, tripLengthMax: parseInt(e.target.value) || 0 })}
                placeholder="最多"
                className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
              />
            </div>
          </div>
        )}

        {/* Budget Cap */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">預算上限（TWD，0=不限）</label>
          <input
            type="number"
            value={form.budgetCap}
            onChange={(e) => setForm({ ...form, budgetCap: parseInt(e.target.value) || 0 })}
            placeholder="例如 30000"
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
          />
        </div>

        {/* Notify Drop % */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">跌價通知門檻（%）</label>
          <input
            type="number"
            value={form.notifyDropPct}
            onChange={(e) => setForm({ ...form, notifyDropPct: parseInt(e.target.value) || 5 })}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-900/40 border border-red-800 p-3 text-xs text-red-300">{error}</div>
        )}

        <button
          onClick={submit}
          disabled={submitting || !form.name || !form.outboundStart || !form.outboundEnd}
          className="w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500"
        >
          {submitting ? '建立中...' : '新增並立即掃描'}
        </button>
      </main>
    </div>
  );
}
