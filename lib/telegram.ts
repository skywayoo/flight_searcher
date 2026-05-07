import { FlightTarget, FlightCombination } from '@/types';
import { getAirportByCode } from '@/lib/regions';

function fmt(n: number) {
  return n.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
}

export async function notifyPriceChange(
  target: FlightTarget,
  current: number,
  prev: number | undefined,
  changePct: number | undefined,
  best: FlightCombination | undefined,
) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  let msg = '';
  if (prev === undefined) {
    msg = `✈️ 新目標首次掃描\n\n${target.name}\n${target.departureAirport} → ${target.region}\n最低價：$${fmt(current)}`;
  } else if (changePct !== undefined && changePct < 0) {
    msg = `📉 機票降價提醒\n\n${target.name}\n${target.departureAirport} → ${target.region}\n$${fmt(prev)} → $${fmt(current)} (${(changePct * 100).toFixed(1)}%)`;
  } else {
    return;
  }

  if (best) {
    const dest = getAirportByCode(best.outboundAirport);
    msg += `\n\n最佳組合：${best.outboundAirport}${dest ? ` ${dest.city}` : ''}`;
    msg += `\n${best.outboundDate}${best.returnDate ? ` ~ ${best.returnDate}` : ''}`;
    msg += `\n航空：${best.airline}`;
    if (best.outStation) msg += `\n外站起點：${best.outStation}`;
  }

  msg += `\n\n查看 → ${process.env.NEXT_PUBLIC_BASE_URL || ''}/targets/${target.id}`;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: msg }),
  }).catch(() => {});
}
