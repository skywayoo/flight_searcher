'use client';
import { useState, KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { REGIONS, REGION_KEYS, DEPARTURE_AIRPORTS, OUT_STATIONS } from '@/lib/regions';

type TripType = 'round_trip' | 'one_way' | 'multi_city_4';
type Segment = { from: string[]; to: string[]; date: string; dateEnd: string };

const ALL_AIRPORTS = [...new Set([
  ...DEPARTURE_AIRPORTS.map((a) => a.code),
  ...OUT_STATIONS.map((a) => a.code),
  ...Object.values(REGIONS).flatMap((r) => r.airports.map((a) => a.code)),
])];

const SEGMENT_PRESETS: Record<number, { label: string; codes: string[] }[]> = {
  0: [
    { label: '外站樞紐', codes: ['HKG', 'BKK', 'ICN', 'PUS', 'KUL', 'SIN', 'MNL'] },
    { label: '日本', codes: ['NRT', 'HND', 'KIX', 'FUK', 'CTS', 'NGO', 'OKA'] },
  ],
  1: [
    { label: '台灣轉機', codes: ['TPE', 'TSA'] },
    { label: '紐西蘭', codes: ['AKL', 'CHC', 'ZQN', 'WLG'] },
    { label: '澳洲', codes: ['SYD', 'MEL', 'BNE', 'PER'] },
  ],
  2: [
    { label: '紐西蘭', codes: ['AKL', 'CHC', 'ZQN', 'WLG'] },
    { label: '澳洲', codes: ['SYD', 'MEL', 'BNE', 'PER'] },
    { label: '台灣', codes: ['TPE', 'TSA'] },
  ],
  3: [
    { label: '台灣', codes: ['TPE', 'TSA'] },
    { label: '外站樞紐', codes: ['HKG', 'BKK', 'ICN', 'PUS', 'KUL', 'SIN'] },
    { label: '日本', codes: ['NRT', 'HND', 'KIX', 'FUK', 'CTS', 'NGO', 'OKA'] },
  ],
};

function MultiAirportInput({
  value,
  onChange,
  presets = [],
  placeholder = '輸入機場代碼 (Enter 加入)',
}: {
  value: string[];
  onChange: (v: string[]) => void;
  presets?: { label: string; codes: string[] }[];
  placeholder?: string;
}) {
  const [input, setInput] = useState('');
  const set = new Set(value);

  const add = (codeRaw: string) => {
    const code = codeRaw.trim().toUpperCase();
    if (!code) return;
    if (set.has(code)) return;
    onChange([...value, code]);
  };
  const remove = (code: string) => onChange(value.filter((c) => c !== code));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      add(input);
      setInput('');
    } else if (e.key === 'Backspace' && input === '' && value.length > 0) {
      remove(value[value.length - 1]);
    }
  };

  const toggleGroup = (codes: string[]) => {
    const allIn = codes.every((c) => set.has(c));
    if (allIn) {
      onChange(value.filter((c) => !codes.includes(c)));
    } else {
      const merged = [...value];
      for (const c of codes) if (!set.has(c)) merged.push(c);
      onChange(merged);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1 min-h-[28px] mb-1">
        {value.map((c) => (
          <span
            key={c}
            className="inline-flex items-center text-xs bg-blue-600 text-white rounded px-1.5 py-0.5"
          >
            <span className="font-mono font-bold">{c}</span>
            <button
              type="button"
              onClick={() => remove(c)}
              className="ml-1 text-white/80 hover:text-white"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        list="all-airports"
        value={input}
        onChange={(e) => setInput(e.target.value.toUpperCase())}
        onKeyDown={onKeyDown}
        onBlur={() => { if (input) { add(input); setInput(''); } }}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-sm text-white"
      />
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {presets.map((g) => {
            const allIn = g.codes.every((c) => set.has(c));
            return (
              <button
                key={g.label}
                type="button"
                onClick={() => toggleGroup(g.codes)}
                className={`text-[10px] px-1.5 py-0.5 rounded transition ${
                  allIn ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
                title={g.codes.join(', ')}
              >
                {g.label} ({g.codes.length})
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function NewTargetPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    tripType: 'round_trip' as TripType,
    departureAirport: 'TPE',
    region: '日本',
    destinationAirports: [] as string[],
    outboundStart: '',
    outboundEnd: '',
    tripLengthMin: 5,
    tripLengthMax: 10,
    budgetCapEcon: 0,
    budgetCapBusiness: 0,
    includeBusiness: false,
    notifyDropPct: 5,
  });

  const [segments, setSegments] = useState<Segment[]>([
    { from: ['HKG'], to: ['TPE'], date: '', dateEnd: '' },
    { from: ['TPE'], to: [], date: '', dateEnd: '' },
    { from: [], to: ['TPE'], date: '', dateEnd: '' },
    { from: ['TPE'], to: ['HKG'], date: '', dateEnd: '' },
  ]);

  const regionAirports = REGIONS[form.region]?.airports || [];

  function updateSegment(i: number, patch: Partial<Segment>) {
    setSegments((arr) => arr.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const isMulti = form.tripType === 'multi_city_4';
      const body: Record<string, unknown> = {
        name: form.name,
        tripType: form.tripType,
        departureAirport: form.departureAirport,
        region: form.region,
        destinationAirports: form.destinationAirports,
        budgetCapEcon: form.budgetCapEcon || undefined,
        budgetCapBusiness: form.includeBusiness ? (form.budgetCapBusiness || undefined) : undefined,
        budgetCap: form.budgetCapEcon || undefined, // legacy fallback
        includeBusiness: form.includeBusiness,
        notifyDropPct: form.notifyDropPct,
        status: 'active',
      };
      if (isMulti) {
        for (let i = 0; i < 4; i++) {
          const s = segments[i];
          if (s.from.length === 0 || s.to.length === 0 || !s.date) {
            throw new Error(`第 ${i + 1} 段請選起點、終點、填日期`);
          }
        }
        // Serialize as comma-separated strings so downstream FlightSegmentSpec stays compatible
        body.segments = segments.map((s) => ({
          from: s.from.join(','),
          to: s.to.join(','),
          date: s.date,
          dateEnd: s.dateEnd || undefined,
        }));
        body.outboundStart = segments[0].date;
        body.outboundEnd = segments[3].dateEnd || segments[3].date;
      } else {
        if (!form.outboundStart || !form.outboundEnd) throw new Error('請選擇出發日範圍');
        body.outboundStart = form.outboundStart;
        body.outboundEnd = form.outboundEnd;
        body.tripLengthMin = form.tripType === 'round_trip' ? form.tripLengthMin : undefined;
        body.tripLengthMax = form.tripType === 'round_trip' ? form.tripLengthMax : undefined;
      }
      const res = await fetch('/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      router.push(`/targets/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失敗');
      setSubmitting(false);
    }
  }

  const isMulti = form.tripType === 'multi_city_4';

  return (
    <div>
      <datalist id="all-airports">
        {ALL_AIRPORTS.map((c) => <option key={c} value={c} />)}
      </datalist>
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
                onClick={() => setForm({ ...form, tripType: t.v as TripType })}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  form.tripType === t.v ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {!isMulti && (
          <>
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

            {/* Destination Airports */}
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
          </>
        )}

        {isMulti && (
          <>
            <div className="rounded-lg bg-blue-900/20 border border-blue-900/40 p-3 text-xs text-blue-200">
              💡 外站四段票：每段可多選機場（cartesian 展開掃描）。範例 seg1：選 HKG + BKK，seg2：選 AKL + CHC，會掃 HKG→TPE→AKL + HKG→TPE→CHC + BKK→TPE→AKL + BKK→TPE→CHC。
            </div>
            {segments.map((seg, i) => (
              <div key={i} className="rounded-xl bg-gray-900 p-3 space-y-3">
                <p className="text-xs font-semibold text-gray-300">第 {i + 1} 段</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">起點（可多選）</label>
                    <MultiAirportInput
                      value={seg.from}
                      onChange={(v) => updateSegment(i, { from: v })}
                      presets={SEGMENT_PRESETS[i]}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">終點（可多選）</label>
                    <MultiAirportInput
                      value={seg.to}
                      onChange={(v) => updateSegment(i, { to: v })}
                      presets={SEGMENT_PRESETS[i]}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">日期 (起)</label>
                    <input
                      type="date"
                      value={seg.date}
                      onChange={(e) => updateSegment(i, { date: e.target.value })}
                      className="w-full rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">日期 (止) 可空</label>
                    <input
                      type="date"
                      value={seg.dateEnd}
                      onChange={(e) => updateSegment(i, { dateEnd: e.target.value })}
                      className="w-full rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-sm text-white"
                    />
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Budget Caps */}
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-gray-400 mb-1">經濟艙預算上限（TWD，0=不限）</label>
            <input
              type="number"
              value={form.budgetCapEcon}
              onChange={(e) => setForm({ ...form, budgetCapEcon: parseInt(e.target.value) || 0 })}
              placeholder="例如 50000"
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.includeBusiness}
              onChange={(e) => setForm({ ...form, includeBusiness: e.target.checked })}
              className="w-4 h-4 rounded border-gray-700 bg-gray-900"
            />
            <span className="text-sm text-gray-300">同時比較商務艙價格</span>
          </label>

          {form.includeBusiness && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">商務艙預算上限（TWD，0=不限）</label>
              <input
                type="number"
                value={form.budgetCapBusiness}
                onChange={(e) => setForm({ ...form, budgetCapBusiness: parseInt(e.target.value) || 0 })}
                placeholder="例如 120000"
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
              />
            </div>
          )}
        </div>

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
          disabled={submitting || !form.name}
          className="w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500"
        >
          {submitting ? '建立中...' : '新增並立即掃描'}
        </button>
      </main>
    </div>
  );
}
