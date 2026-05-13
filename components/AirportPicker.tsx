'use client';

import { useMemo, useState } from 'react';
import {
  AIRPORTS,
  AIRPORT_MAP,
  QUICK_GROUPS,
  groupByCountry,
  searchAirports,
  type Airport,
} from '@/lib/airports';

interface AirportPickerProps {
  /** Selected airport codes */
  value: string[];
  /** Callback when selection changes */
  onChange: (codes: string[]) => void;
  /** Label shown above the picker */
  label?: string;
  /** Optional placeholder when nothing selected */
  placeholder?: string;
  /** Optional className for outer wrapper */
  className?: string;
}

export function AirportPicker({
  value,
  onChange,
  label,
  placeholder = '未選擇機場',
  className = '',
}: AirportPickerProps) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const selectedSet = useMemo(() => new Set(value), [value]);

  // 列表:有搜尋字串就用 flat list,否則照國家分組
  const grouped = useMemo(() => groupByCountry(), []);
  const filtered = useMemo(() => searchAirports(search), [search]);
  const showFlat = search.trim().length > 0;

  const toggle = (code: string) => {
    if (selectedSet.has(code)) {
      onChange(value.filter((c) => c !== code));
    } else {
      onChange([...value, code]);
    }
  };

  const applyGroup = (codes: string[]) => {
    const newSet = new Set(value);
    for (const c of codes) newSet.add(c);
    onChange(Array.from(newSet));
  };

  const removeGroup = (codes: string[]) => {
    const removeSet = new Set(codes);
    onChange(value.filter((c) => !removeSet.has(c)));
  };

  const toggleGroup = (codes: string[]) => {
    // 若該群組全部都已選 → 移除,否則加入
    const allSelected = codes.every((c) => selectedSet.has(c));
    if (allSelected) {
      removeGroup(codes);
    } else {
      applyGroup(codes);
    }
  };

  const clearAll = () => onChange([]);

  const toggleCountryCollapse = (country: string) => {
    setCollapsed((prev) => ({ ...prev, [country]: !prev[country] }));
  };

  const selectAllInCountry = (airports: Airport[]) => {
    applyGroup(airports.map((a) => a.code));
  };

  const clearCountry = (airports: Airport[]) => {
    removeGroup(airports.map((a) => a.code));
  };

  return (
    <div className={`w-full border border-gray-300 rounded-lg p-4 bg-white ${className}`}>
      {label && (
        <div className="mb-3 text-sm font-semibold text-gray-700">{label}</div>
      )}

      {/* 快速群組按鈕 */}
      <div className="mb-3">
        <div className="text-xs text-gray-500 mb-1">快速選取</div>
        <div className="flex flex-wrap gap-1">
          {QUICK_GROUPS.map((g) => {
            const allSelected = g.codes.every((c) => selectedSet.has(c));
            return (
              <button
                key={g.name}
                type="button"
                onClick={() => toggleGroup(g.codes)}
                className={`text-xs px-2 py-1 rounded border transition ${
                  allSelected
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
                title={g.codes.join(', ')}
              >
                {g.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* 已選 chips */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs text-gray-500">已選 ({value.length})</div>
          {value.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-red-500 hover:text-red-700"
            >
              清空
            </button>
          )}
        </div>
        <div className="min-h-[36px] flex flex-wrap gap-1 p-2 bg-gray-50 rounded border border-gray-200">
          {value.length === 0 && (
            <div className="text-xs text-gray-400">{placeholder}</div>
          )}
          {value.map((code) => {
            const a = AIRPORT_MAP[code];
            return (
              <span
                key={code}
                className="inline-flex items-center text-xs bg-blue-100 text-blue-800 rounded px-2 py-0.5"
              >
                <span className="font-mono font-bold">{code}</span>
                {a && <span className="ml-1">{a.zhName}</span>}
                <button
                  type="button"
                  onClick={() => toggle(code)}
                  className="ml-1 text-blue-600 hover:text-blue-900"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      </div>

      {/* 搜尋 */}
      <div className="mb-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋(代碼 / 中文 / 國家)..."
          className="w-full text-sm px-3 py-1.5 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* 機場列表 */}
      <div className="max-h-72 overflow-y-auto border border-gray-200 rounded bg-white">
        {showFlat ? (
          // 搜尋模式:flat list
          <div className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <div className="text-xs text-gray-400 px-3 py-4 text-center">
                沒有符合的機場
              </div>
            )}
            {filtered.map((a) => (
              <AirportRow
                key={a.code}
                airport={a}
                selected={selectedSet.has(a.code)}
                onClick={() => toggle(a.code)}
              />
            ))}
          </div>
        ) : (
          // 國家分組模式
          grouped.map(({ country, countryZh, airports }) => {
            const isCollapsed = collapsed[country];
            const selectedCount = airports.filter((a) =>
              selectedSet.has(a.code)
            ).length;
            return (
              <div key={country} className="border-b border-gray-100 last:border-b-0">
                <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50">
                  <button
                    type="button"
                    onClick={() => toggleCountryCollapse(country)}
                    className="flex items-center text-xs font-semibold text-gray-700 hover:text-gray-900"
                  >
                    <span className="mr-1">{isCollapsed ? '▸' : '▾'}</span>
                    {countryZh}
                    <span className="ml-2 text-gray-400 font-normal">
                      ({selectedCount}/{airports.length})
                    </span>
                  </button>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => selectAllInCountry(airports)}
                      className="text-xs text-blue-500 hover:text-blue-700"
                    >
                      全選
                    </button>
                    {selectedCount > 0 && (
                      <button
                        type="button"
                        onClick={() => clearCountry(airports)}
                        className="text-xs text-gray-500 hover:text-red-500"
                      >
                        清除
                      </button>
                    )}
                  </div>
                </div>
                {!isCollapsed && (
                  <div className="divide-y divide-gray-100">
                    {airports.map((a) => (
                      <AirportRow
                        key={a.code}
                        airport={a}
                        selected={selectedSet.has(a.code)}
                        onClick={() => toggle(a.code)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ============================================================
// Sub-component: single airport row
// ============================================================

interface AirportRowProps {
  airport: Airport;
  selected: boolean;
  onClick: () => void;
}

function AirportRow({ airport, selected, onClick }: AirportRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center px-3 py-1.5 text-left text-sm hover:bg-blue-50 transition ${
        selected ? 'bg-blue-50' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        readOnly
        className="mr-2"
      />
      <span className="font-mono font-bold text-blue-700 w-12">{airport.code}</span>
      <span className="text-gray-700">{airport.zhName}</span>
      <span className="ml-auto text-xs text-gray-400">{airport.enName}</span>
    </button>
  );
}
