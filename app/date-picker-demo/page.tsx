'use client';

import { useState } from 'react';
import { DatePicker } from '@/components/DatePicker';

export default function DatePickerDemo() {
  const [seg1Dates, setSeg1Dates] = useState<string[]>([]);
  const [seg2Dates, setSeg2Dates] = useState<string[]>([]);
  const [seg4Dates, setSeg4Dates] = useState<string[]>([]);

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-1">日期選取器 Demo</h1>
      <p className="text-sm text-gray-500 mb-6">
        DatePicker 元件 — 單點 / 範圍 兩種模式
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <DatePicker
          label="Seg1 出發日期"
          value={seg1Dates}
          onChange={setSeg1Dates}
        />
        <DatePicker
          label="Seg2 出發日期"
          value={seg2Dates}
          onChange={setSeg2Dates}
        />
        <DatePicker
          label="Seg4 出發日期"
          value={seg4Dates}
          onChange={setSeg4Dates}
        />
      </div>

      <div className="mt-8 p-4 bg-gray-50 border border-gray-200 rounded">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">當前選擇 (JSON)</h2>
        <pre className="text-xs bg-white p-3 rounded border border-gray-200 overflow-x-auto">
{JSON.stringify(
  {
    seg1Dates,
    seg2Dates,
    seg4Dates,
  },
  null,
  2,
)}
        </pre>
        <div className="mt-3 text-xs text-gray-500">
          總組合估算:{seg1Dates.length} × {seg2Dates.length} × {seg4Dates.length} ={' '}
          <strong>
            {(seg1Dates.length * seg2Dates.length * seg4Dates.length) || 0}
          </strong>
          (還沒乘機場 / cabin / stay)
        </div>
      </div>

      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
        <strong>使用提示:</strong>
        <ul className="mt-2 list-disc list-inside space-y-1">
          <li><b>單點模式</b>:點日期切換選 / 不選</li>
          <li><b>範圍模式</b>:點起點 → 點終點 → 中間全選</li>
          <li><b>整月全選</b>:按按鈕選當月所有未來日期</li>
          <li><b>過去日期</b>:灰色,不能選</li>
          <li><b>當天</b>:有藍色框框</li>
        </ul>
      </div>
    </div>
  );
}
