export type GiftItem = {
  id: string;
  name: string;
  costKernel: number;
  emoji: string;
  accent: string;
};

export const GIFT_CATALOG: GiftItem[] = [
  { id: "candy", name: "Candy", costKernel: 50, emoji: "🍬", accent: "#FF8BC2" },
  { id: "banana_milk", name: "Banana Milk", costKernel: 200, emoji: "🥛", accent: "#FFD45F" },
  { id: "ice_cream", name: "Ice Cream", costKernel: 200, emoji: "🍨", accent: "#8ED7FF" },
  { id: "rose", name: "Rose", costKernel: 300, emoji: "🌹", accent: "#FF6F8A" },
  { id: "love_heart", name: "Love Heart", costKernel: 300, emoji: "💖", accent: "#FF72D1" },
  { id: "cotton_candy", name: "Cotton Candy", costKernel: 500, emoji: "🍭", accent: "#FF99EC" },
  { id: "toy_hammer", name: "Toy Hammer", costKernel: 500, emoji: "🔨", accent: "#A4A1FF" },
  { id: "birthday_cake", name: "Birthday Cake", costKernel: 1000, emoji: "🎂", accent: "#FFC785" },
  { id: "heart_balloon", name: "Heart Balloon", costKernel: 1000, emoji: "🎈", accent: "#FF5E84" },
  { id: "kiss", name: "Kiss", costKernel: 2000, emoji: "💋", accent: "#FF7B9D" },
  { id: "arrow", name: "Arrow", costKernel: 2000, emoji: "🏹", accent: "#A8C3FF" },
  { id: "crystal_rose", name: "Crystal Rose", costKernel: 3000, emoji: "💎", accent: "#90E5FF" },
  { id: "magic_wand", name: "Magic Wand", costKernel: 5000, emoji: "🪄", accent: "#C8A3FF" },
  { id: "teddy_bear", name: "Teddy Bear", costKernel: 10000, emoji: "🧸", accent: "#C8A66A" },
  { id: "bouquet", name: "Bouquet", costKernel: 20000, emoji: "💐", accent: "#FF8FB2" },
  { id: "ring", name: "Ring", costKernel: 50000, emoji: "💍", accent: "#A7F2FF" },
  { id: "supercar", name: "Supercar", costKernel: 100000, emoji: "🏎️", accent: "#FF7676" },
  { id: "seal_stamp", name: "Seal Stamp", costKernel: 200000, emoji: "🔏", accent: "#B0B0B0" },
];

const GIFT_MAP: Record<string, GiftItem> = GIFT_CATALOG.reduce((acc, item) => {
  acc[item.id] = item;
  return acc;
}, {} as Record<string, GiftItem>);

export function getGiftById(id: string): GiftItem | null {
  const key = String(id || "").trim();
  return key && GIFT_MAP[key] ? GIFT_MAP[key] : null;
}

export function getGiftDisplayName(
  t: (key: string, params?: Record<string, unknown>) => string,
  gift: Pick<GiftItem, "id" | "name"> | null | undefined
): string {
  const id = String(gift?.id || "").trim();
  if (!id) return String(gift?.name || "");
  const key = `gift.name.${id}`;
  const translated = t(key);
  return translated && translated !== key ? translated : String(gift?.name || "");
}
