// Live XLM price, used only to show an approximate local-currency value next to amounts.
export type Fiat = 'INR' | 'CAD' | 'USD';
export type Prices = Partial<Record<Fiat, number>>;

const SYMBOL: Record<Fiat, string> = { INR: '₹', CAD: 'CA$', USD: 'US$' };

export async function fetchPrices(): Promise<Prices> {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=inr,cad,usd');
    const j = await r.json();
    const s = j?.stellar ?? {};
    return { INR: s.inr, CAD: s.cad, USD: s.usd };
  } catch {
    return {};
  }
}

export function fiat(xlm: number, cur: Fiat, prices: Prices): string | null {
  const p = prices[cur];
  if (!p) return null;
  const v = xlm * p;
  return `${SYMBOL[cur]}${v.toLocaleString('en-IN', { maximumFractionDigits: v < 10 ? 2 : 0 })}`;
}

export const xlm = (n: number) =>
  `${n.toLocaleString('en-IN', { maximumFractionDigits: n < 1 ? 4 : 2 })} XLM`;
