import AsyncStorage from "@react-native-async-storage/async-storage";

export const storage = {
  get: async <T>(key: string): Promise<T | null> => {
    const v = await AsyncStorage.getItem(key);
    if (!v) return null;
    return JSON.parse(v) as T;
  },
  set: async (key: string, value: any) => {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },
  del: async (key: string) => {
    await AsyncStorage.removeItem(key);
  },
  clear: async () => {
    await AsyncStorage.clear();
  },
};