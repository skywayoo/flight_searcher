'use client';

import { useMemo, useState } from 'react';

interface DatePickerProps {
  /** Selected dates as ISO strings (YYYY-MM-DD) */
  value: string[];
  /** Callback when selection changes */
  onChange: (dates: string[]) => void;
  /** Label shown above the picker */
  label?: string;
  /** Allow selecting past dates (default false) */
  allowPast?: boolean;
  /** Optional className for outer wrapper */
  className?: string;
}

type Mode = 'toggle' | 'range';

export function DatePicker({
  value,
  onChange,
  label,
  allowPast = false,
  className = '',
}: DatePickerProps) {
  // 預設顯示的月份:有選日期就用第一筆,否則用今天
  const initialMonth = useMemo(() => {
    if (value.length > 0) {
      const d = new Date(value[0]);
      return new Date(d.getFullYear(), d.getMonth(), 1);
    }
    return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [viewMonth, setViewMonth] = useState<Date>(initialMonth);
  const [mode, setMode] = useState<Mode>('toggle');
  const [rangeStart, setRangeStart] = useState<string | null>(null);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const today = useMemo(() => toIsoDate(new Date()), []);

  // === 計算當月 grid ===
  const monthGrid = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);

  // === 操作 ===
  const toggleDate = (iso: string) => {
    if (selectedSet.has(iso)) {
      onChange(value.filter((d) => d !== iso));
    } else {
      onChange([...value, iso].sort());
    }
  };

  const handleClick = (iso: string, disabled: boolean) => {
    if (disabled) return;
    if (mode === 'toggle') {
      toggleDate(iso);
      return;
    }
    // range mode
    if (rangeStart === null) {
      setRangeStart(iso);
    } else {
      // 完成範圍
      const [start, end] = [rangeStart, iso].sort();
      const rangeDates = enumerateDates(start, end);
      const newSet = new Set(value);
      for (const d of rangeDates) {
        if (allowPast || d >= today) newSet.add(d);
      }
      onChange(Array.from(newSet).sort());
      setRangeStart(null);
    }
  };

  const clearAll = () => onChange([]);
  const removeDate = (iso: string) => onChange(value.filter((d) => d !== iso));

  const prevMonth = () => {
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
    setRangeStart(null);
  };
  const nextMonth = () => {
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
    setRangeStart(null);
  };
  const goToday = () => {
    const now = new Date();
    setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setRangeStart(null);
  };

  // 整月全選
  const selectWholeMonth = () => {
    const allInMonth = monthGrid
      .filter((c) => c.inMonth && (allowPast || c.iso >= today))
      .map((c) => c.iso);
    const newSet = new Set(value);
    for (const d of allInMonth) newSet.add(d);
    onChange(Array.from(newSet).sort());
  };

  // === Render ===
  const monthLabel = `${viewMonth.getFullYear()} 年 ${viewMonth.getMonth() + 1} 月`;

  return (
    <div className={`w-full border border-gray-300 rounded-lg p-4 bg-white ${className}`}>
      {label && (
        <div className="mb-3 text-sm font-semibold text-gray-700">{label}</div>
      )}

      {/* 模式切換 + 快速操作 */}
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <div className="inline-flex rounded border border-gray-300 overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => { setMode('toggle'); setRangeStart(null); }}
            className={`px-3 py-1 ${mode === 'toggle' ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
          >
            單點
          </button>
          <button
            type="button"
            onClick={() => { setMode('range'); setRangeStart(null); }}
            className={`px-3 py-1 border-l border-gray-300 ${mode === 'range' ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
          >
            範圍
          </button>
        </div>

        <div className="flex gap-1 text-xs">
          <button
            type="button"
            onClick={selectWholeMonth}
            className="px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
          >
            整月全選
          </button>
          <button
            type="button"
            onClick={goToday}
            className="px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
          >
            今天
          </button>
          {value.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="px-2 py-1 border border-red-300 text-red-500 rounded hover:bg-red-50"
            >
              清空
            </button>
          )}
        </div>
      </div>

      {/* 範圍模式提示 */}
      {mode === 'range' && (
        <div className="mb-2 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
          {rangeStart
            ? `起點:${formatShort(rangeStart)} — 請點選終點`
            : '請點選起點'}
        </div>
      )}

      {/* 已選 chips */}
      <div className="mb-3">
        <div className="text-xs text-gray-500 mb-1">已選 ({value.length})</div>
        <div className="min-h-[36px] flex flex-wrap gap-1 p-2 bg-gray-50 rounded border border-gray-200">
          {value.length === 0 && (
            <div className="text-xs text-gray-400">未選擇日期</div>
          )}
          {value.map((iso) => (
            <span
              key={iso}
              className="inline-flex items-center text-xs bg-blue-100 text-blue-800 rounded px-2 py-0.5"
            >
              {formatShort(iso)}
              <button
                type="button"
                onClick={() => removeDate(iso)}
                className="ml-1 text-blue-600 hover:text-blue-900"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* 月份切換 */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={prevMonth}
          className="px-2 py-1 text-gray-600 hover:bg-gray-100 rounded"
        >
          ◀
        </button>
        <div className="text-sm font-semibold text-gray-700">{monthLabel}</div>
        <button
          type="button"
          onClick={nextMonth}
          className="px-2 py-1 text-gray-600 hover:bg-gray-100 rounded"
        >
          ▶
        </button>
      </div>

      {/* 日曆 */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {['日', '一', '二', '三', '四', '五', '六'].map((d) => (
          <div key={d} className="text-xs text-gray-500 py-1">
            {d}
          </div>
        ))}
        {monthGrid.map((cell, idx) => {
          const isPast = !allowPast && cell.iso < today;
          const disabled = isPast;
          const selected = selectedSet.has(cell.iso);
          const isToday = cell.iso === today;
          const isRangeStart = mode === 'range' && rangeStart === cell.iso;

          return (
            <button
              key={idx}
              type="button"
              disabled={disabled}
              onClick={() => handleClick(cell.iso, disabled)}
              className={`
                aspect-square text-xs rounded transition relative
                ${!cell.inMonth ? 'text-gray-300' : ''}
                ${disabled ? 'text-gray-300 cursor-not-allowed' : 'cursor-pointer hover:bg-blue-100'}
                ${selected && !disabled ? 'bg-blue-500 text-white hover:bg-blue-600' : ''}
                ${isRangeStart ? 'ring-2 ring-orange-400' : ''}
                ${isToday && !selected ? 'border border-blue-400' : ''}
              `}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

interface DayCell {
  iso: string;
  day: number;
  inMonth: boolean;
}

function buildMonthGrid(viewMonth: Date): DayCell[] {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();

  const first = new Date(year, month, 1);
  const firstWeekday = first.getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: DayCell[] = [];

  // 前面填上上個月的尾巴
  for (let i = 0; i < firstWeekday; i++) {
    const d = new Date(year, month, -i);
    cells.unshift({
      iso: toIsoDate(d),
      day: d.getDate(),
      inMonth: false,
    });
  }

  // 本月
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    cells.push({
      iso: toIsoDate(d),
      day,
      inMonth: true,
    });
  }

  // 後面填到 42 個 cell(6 週)
  while (cells.length < 42) {
    const last = cells[cells.length - 1];
    const lastDate = new Date(last.iso);
    lastDate.setDate(lastDate.getDate() + 1);
    cells.push({
      iso: toIsoDate(lastDate),
      day: lastDate.getDate(),
      inMonth: false,
    });
  }

  return cells;
}

function enumerateDates(start: string, end: string): string[] {
  const result: string[] = [];
  const s = new Date(start);
  const e = new Date(end);
  while (s <= e) {
    result.push(toIsoDate(s));
    s.setDate(s.getDate() + 1);
  }
  return result;
}

function formatShort(iso: string): string {
  const d = new Date(iso);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${m}/${day} (${weekdays[d.getDay()]})`;
}
