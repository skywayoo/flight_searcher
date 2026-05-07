'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function TargetActions({ targetId, status }: { targetId: string; status: 'active' | 'paused' }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'scan' | 'toggle' | 'delete' | null>(null);
  const [, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  async function scan() {
    setBusy('scan');
    setMsg('掃描中（可能要 1-3 分鐘）...');
    try {
      const res = await fetch(`/api/targets/${targetId}/scan`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      setMsg('掃描完成 ✓');
      startTransition(() => router.refresh());
    } catch (e) {
      setMsg(`掃描失敗：${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setBusy(null);
    }
  }

  async function toggle() {
    setBusy('toggle');
    try {
      await fetch(`/api/targets/${targetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: status === 'active' ? 'paused' : 'active' }),
      });
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  async function del() {
    if (!confirm('確定刪除這個監控目標？')) return;
    setBusy('delete');
    try {
      await fetch(`/api/targets/${targetId}`, { method: 'DELETE' });
      router.push('/');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={scan}
          disabled={!!busy}
          className="rounded-lg bg-blue-600 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:bg-gray-700"
        >
          {busy === 'scan' ? '掃描中...' : '立即掃描'}
        </button>
        <button
          onClick={toggle}
          disabled={!!busy}
          className="rounded-lg bg-gray-800 py-2 text-xs font-medium text-gray-300 hover:bg-gray-700"
        >
          {status === 'active' ? '暫停監控' : '恢復監控'}
        </button>
        <button
          onClick={del}
          disabled={!!busy}
          className="rounded-lg bg-red-900/40 border border-red-800 py-2 text-xs font-medium text-red-300 hover:bg-red-900/60"
        >
          刪除
        </button>
      </div>
      {msg && <p className="text-xs text-gray-400">{msg}</p>}
    </>
  );
}
