// App-wide state: the wallet keypair, settings, saved people, outstanding claim codes,
// live prices, and a tiny screen stack.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Linking, Platform } from 'react-native';
import type { Keypair } from '@stellar/stellar-sdk';
import * as S from './stellar';
import * as P from './pot';
import { Key, Lang, translate } from './i18n';
import { Fiat, Prices, fetchPrices } from './price';
import { loadJSON, loadSecret, saveJSON, saveSecret } from './storage';

export type Settings = { lang: Lang; scale: 1 | 1.25 | 1.5; fiat: Fiat; anchorDomain: string };
/** A cash in / cash out started with an anchor; kept so it can be resumed after closing the app. */
export type AnchorRecord = { id: string; kind: 'deposit' | 'withdraw'; domain: string; amount?: number; status: string; paidHash?: string; createdAt: number };
export type Contact = { name: string; address: string };
export type Invite = { publicKey: string; secret: string; name: string; amount: number; createdAt: number };
/** A pot spending request this phone made or approved; the signed transaction travels as a link. */
export type SavedProposal = { xdr: string; potId: string; createdAt: number };

/** Network handle for the Family Care Pot module. */
export const potNet: P.Net = { server: S.server, passphrase: S.passphrase };

export type Route =
  | { name: 'welcome' }
  | { name: 'restore' }
  | { name: 'home' }
  | { name: 'send' }
  | { name: 'receive' }
  | { name: 'claim'; code?: string }
  | { name: 'settings' }
  | { name: 'anchor'; kind: 'deposit' | 'withdraw'; resumeId?: string }
  | { name: 'createPot' }
  | { name: 'pot'; id: string }
  | { name: 'propose'; potId: string }
  | { name: 'proposal'; xdr: string };

type Ctx = {
  ready: boolean;
  keypair: Keypair | null;
  wallet: S.WalletState | null;
  incoming: S.PendingBalance[];
  outgoing: S.PendingBalance[];
  invites: (Invite & { status: S.InviteStatus })[];
  activity: S.Activity[];
  prices: Prices;
  settings: Settings;
  contacts: Contact[];
  loading: boolean;
  error: string | null;
  t: (k: Key, v?: Record<string, string | number>) => string;
  nameFor: (address?: string) => string;
  setSettings: (s: Partial<Settings>) => void;
  setKeypair: (kp: Keypair | null) => Promise<void>;
  saveContact: (c: Contact) => void;
  addInvite: (i: Invite) => void;
  anchorTxs: AnchorRecord[];
  saveAnchorTx: (r: AnchorRecord) => void;
  pots: P.PotInfo[];
  proposals: SavedProposal[];
  saveProposal: (p: SavedProposal) => void;
  removeProposal: (xdrOrHashPrefix: string) => void;
  refresh: () => Promise<void>;
  route: Route;
  go: (r: Route) => void;
  back: () => void;
  announce: (msg: string) => void;
};

const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

const defaults: Settings = { lang: 'en', scale: 1, fiat: 'INR', anchorDomain: S.NETWORK === 'testnet' ? 'testanchor.stellar.org' : '' };

/** Screens a link can open: a claim code, or a family pot approval request. */
function routeFromUrl(url?: string | null): Route | undefined {
  if (!url) return;
  const claim = url.match(/[?&](?:claim|code)=([A-Z2-7]{56})/);
  if (claim) return { name: 'claim', code: claim[1] };
  const prop = url.match(/[?&](?:proposal|x)=([^&#]+)/);
  if (prop) return { name: 'proposal', xdr: decodeURIComponent(prop[1]) };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [keypair, setKp] = useState<Keypair | null>(null);
  const [settings, setSettingsState] = useState<Settings>(defaults);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [anchorTxs, setAnchorTxs] = useState<AnchorRecord[]>([]);
  const [pots, setPots] = useState<P.PotInfo[]>([]);
  const [proposals, setProposals] = useState<SavedProposal[]>([]);
  const [inviteStatus, setInviteStatus] = useState<Record<string, S.InviteStatus>>({});
  const [wallet, setWallet] = useState<S.WalletState | null>(null);
  const [incoming, setIncoming] = useState<S.PendingBalance[]>([]);
  const [outgoing, setOutgoing] = useState<S.PendingBalance[]>([]);
  const [activity, setActivity] = useState<S.Activity[]>([]);
  const [prices, setPrices] = useState<Prices>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stack, setStack] = useState<Route[]>([{ name: 'welcome' }]);

  const t = useCallback((k: Key, v?: Record<string, string | number>) => translate(settings.lang, k, v), [settings.lang]);

  const go = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = (r: Route) => setStack([r]);

  const announce = useCallback((msg: string) => AccessibilityInfo.announceForAccessibility(msg), []);

  // Boot: settings, saved data, wallet key, and any claim link the app was opened with.
  useEffect(() => {
    (async () => {
      const [s, c, inv, secret, anc, props] = await Promise.all([
        loadJSON('settings', defaults),
        loadJSON<{ list: Contact[] }>('contacts', { list: [] }),
        loadJSON<{ list: Invite[] }>('invites', { list: [] }),
        loadSecret(),
        loadJSON<{ list: AnchorRecord[] }>('anchorTxs', { list: [] }),
        loadJSON<{ list: SavedProposal[] }>('proposals', { list: [] }),
      ]);
      setAnchorTxs(anc.list);
      setProposals(props.list);
      setSettingsState(s);
      setContacts(c.list);
      setInvites(inv.list);
      let linked = routeFromUrl(await Linking.getInitialURL());
      if (!linked && Platform.OS === 'web' && typeof window !== 'undefined') linked = routeFromUrl(window.location.href);
      // Don't leave claim codes or signed requests in the address bar / browser history.
      if (linked && Platform.OS === 'web' && typeof window !== 'undefined') window.history.replaceState(null, '', window.location.pathname);
      if (secret && S.isValidSecret(secret)) {
        setKp(S.keypairFromSecret(secret));
        setStack(linked ? [{ name: 'home' }, linked] : [{ name: 'home' }]);
      } else if (linked) {
        setStack([{ name: 'welcome' }, linked]);
      }
      setReady(true);
    })();
    const sub = Linking.addEventListener('url', ({ url }) => {
      const linked = routeFromUrl(url);
      if (linked) setStack((st) => [...st, linked]);
    });
    fetchPrices().then(setPrices);
    return () => sub.remove();
  }, []);

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsState((s) => {
      const next = { ...s, ...patch };
      saveJSON('settings', next);
      return next;
    });
  }, []);

  const setKeypair = useCallback(async (kp: Keypair | null) => {
    await saveSecret(kp ? kp.secret() : null);
    setKp(kp);
    setWallet(null);
    setIncoming([]);
    setOutgoing([]);
    setActivity([]);
    reset(kp ? { name: 'home' } : { name: 'welcome' });
  }, []);

  const saveContact = useCallback((c: Contact) => {
    setContacts((list) => {
      const next = [c, ...list.filter((x) => x.address !== c.address)];
      saveJSON('contacts', { list: next });
      return next;
    });
  }, []);

  const addInvite = useCallback((i: Invite) => {
    setInvites((list) => {
      const next = [i, ...list];
      saveJSON('invites', { list: next });
      return next;
    });
    setInviteStatus((m) => ({ ...m, [i.publicKey]: 'waiting' }));
  }, []);

  const saveAnchorTx = useCallback((r: AnchorRecord) => {
    setAnchorTxs((list) => {
      // Merge, so a status update never drops what an earlier save recorded (e.g. paidHash).
      const prev = list.find((x) => x.id === r.id);
      const merged = { ...prev, ...r, paidHash: r.paidHash ?? prev?.paidHash, createdAt: prev?.createdAt ?? r.createdAt };
      const next = [merged, ...list.filter((x) => x.id !== r.id)].slice(0, 20);
      saveJSON('anchorTxs', { list: next });
      return next;
    });
  }, []);

  const saveProposal = useCallback((p: SavedProposal) => {
    setProposals((list) => {
      // A newer signature on the same request replaces the older copy (same tx hash prefix).
      const key = p.xdr.slice(0, 120);
      const next = [p, ...list.filter((x) => x.xdr.slice(0, 120) !== key)].slice(0, 30);
      saveJSON('proposals', { list: next });
      return next;
    });
  }, []);

  const removeProposal = useCallback((xdr: string) => {
    setProposals((list) => {
      const next = list.filter((x) => x.xdr.slice(0, 120) !== xdr.slice(0, 120));
      saveJSON('proposals', { list: next });
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!keypair) return;
    const pk = keypair.publicKey();
    setLoading(true);
    setError(null);
    try {
      const [w, inc, out, act] = await Promise.all([S.getWallet(pk), S.incoming(pk), S.outgoing(pk), S.history(pk)]);
      setWallet(w);
      setIncoming(inc);
      setOutgoing(out);
      setActivity(act);
      const statuses = await Promise.all(
        invites.map(async (i) => [i.publicKey, (await S.inviteStatus(pk, i.publicKey)).status] as const),
      );
      setInviteStatus(Object.fromEntries(statuses));
      const ids = await P.myPots(potNet, pk);
      setPots(await Promise.all(ids.map((id) => P.getPot(potNet, id))));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [keypair, invites]);

  useEffect(() => {
    if (!keypair) return;
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [keypair, refresh]);

  const nameFor = useCallback(
    (address?: string) => {
      if (!address) return t('someone');
      if (keypair && address === keypair.publicKey()) return t('you');
      const c = contacts.find((x) => x.address === address);
      if (c) return c.name;
      const inv = invites.find((x) => x.publicKey === address);
      if (inv) return inv.name;
      const pot = pots.find((x) => x.id === address);
      if (pot) return pot.name;
      for (const p of pots) {
        const m = p.members.find((x) => x.address === address);
        if (m) return m.name;
      }
      return `${address.slice(0, 4)}…${address.slice(-4)}`;
    },
    [contacts, invites, pots, keypair, t],
  );

  const value = useMemo<Ctx>(
    () => ({
      ready,
      keypair,
      wallet,
      incoming,
      outgoing,
      invites: invites
        .map((i) => ({ ...i, status: inviteStatus[i.publicKey] ?? 'waiting' }))
        .filter((i) => i.status === 'waiting'),
      activity,
      prices,
      settings,
      contacts,
      loading,
      error,
      t,
      nameFor,
      setSettings,
      setKeypair,
      saveContact,
      addInvite,
      anchorTxs,
      saveAnchorTx,
      pots,
      proposals,
      saveProposal,
      removeProposal,
      refresh,
      route: stack[stack.length - 1],
      go,
      back,
      announce,
    }),
    [ready, keypair, wallet, incoming, outgoing, invites, inviteStatus, activity, prices, settings, contacts, loading, error, t, nameFor, setSettings, setKeypair, saveContact, addInvite, anchorTxs, saveAnchorTx, pots, proposals, saveProposal, removeProposal, refresh, stack, go, back, announce],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
