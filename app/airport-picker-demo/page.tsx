'use client';

import { useState } from 'react';
import { AirportPicker } from '@/components/AirportPicker';

export default function AirportPickerDemo() {
  const [seg1From, setSeg1From] = useState<string[]>([]);
  const [seg2To, setSeg2To] = useState<string[]>([]);
  const [seg4From, setSeg4From] = useState<string[]>(['TPE']);
  const [seg4To, setSeg4To] = useState<string[]>([]);

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-1">機票搜尋條件設定</h1>
      <p className="text-sm text-gray-500 mb-6">AirportPicker demo</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <AirportPicker
          label="Seg1 出發機場(日韓)"
          value={seg1From}
          onChange={setSeg1From}
          placeholder="請選擇出發機場"
        />
        <AirportPicker
          label="Seg2 抵達機場(紐西蘭)"
          value={seg2To}
          onChange={setSeg2To}
          placeholder="請選擇紐西蘭機場"
        />
        <AirportPicker
          label="Seg4 出發機場(台灣)"
          value={seg4From}
          onChange={setSeg4From}
        />
        <AirportPicker
          label="Seg4 抵達機場(日韓)"
          value={seg4To}
          onChange={setSeg4To}
          placeholder="可以跟 Seg1 不同"
        />
      </div>

      {/* 輸出區 - 看選了什麼 */}
      <div className="mt-8 p-4 bg-gray-50 border border-gray-200 rounded">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">當前選擇 (JSON)</h2>
        <pre className="text-xs bg-white p-3 rounded border border-gray-200 overflow-x-auto">
{JSON.stringify(
  {
    seg1From,
    seg2To,
    seg4From,
    seg4To,
  },
  null,
  2,
)}
        </pre>
        <div className="mt-3 text-xs text-gray-500">
          總組合估算:{seg1From.length} × {seg2To.length} × {seg4From.length} ×{' '}
          {seg4To.length} ={' '}
          <strong>
            {seg1From.length * seg2To.length * seg4From.length * seg4To.length || 0}
          </strong>
          (還沒乘日期)
        </div>
      </div>
    </div>
  );
}
