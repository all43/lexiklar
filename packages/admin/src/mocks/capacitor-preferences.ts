/**
 * Mock @capacitor/preferences for admin — uses localStorage.
 */
export const Preferences = {
  async get({ key }: { key: string }) {
    return { value: localStorage.getItem(key) };
  },
  async set({ key, value }: { key: string; value: string }) {
    localStorage.setItem(key, value);
  },
  async remove({ key }: { key: string }) {
    localStorage.removeItem(key);
  },
  async keys() {
    return { keys: Object.keys(localStorage) };
  },
};
