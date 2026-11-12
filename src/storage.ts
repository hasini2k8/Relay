// The wallet key lives in the device keychain (SecureStore). On web, where there is
// no keychain, it falls back to localStorage, which is fine for testnet demos only.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const web = Platform.OS === 'web';

async function get(key: string): Promise<string | null> {
  if (web) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function set(key: string, value: string | null) {
  if (web) {
    try {
      value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
    } catch {}
    return;
  }
  value === null ? await SecureStore.deleteItemAsync(key) : await SecureStore.setItemAsync(key, value);
}

export const loadSecret = () => get('relay.secret');
export const saveSecret = (s: string | null) => set('relay.secret', s);

export async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await get(`relay.${key}`);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export const saveJSON = (key: string, value: unknown) => set(`relay.${key}`, JSON.stringify(value));
