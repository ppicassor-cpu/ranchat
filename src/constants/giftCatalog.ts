export type GiftItem = {
  id: string;
  name: string;
  costKernel: number;
  emoji: string;
  accent: string;
};

export const GIFT_CATALOG: GiftItem[] = [
  { id: "candy", name: "사탕", costKernel: 50, emoji: "🍬", accent: "#FF8BC2" },
  { id: "banana_milk", name: "바나나우유", costKernel: 200, emoji: "🥛", accent: "#FFD45F" },
  { id: "ice_cream", name: "아이스크림", costKernel: 200, emoji: "🍨", accent: "#8ED7FF" },
  { id: "rose", name: "장미", costKernel: 300, emoji: "🌹", accent: "#FF6F8A" },
  { id: "love_heart", name: "러브하트", costKernel: 300, emoji: "💖", accent: "#FF72D1" },
  { id: "cotton_candy", name: "솜사탕", costKernel: 500, emoji: "🍭", accent: "#FF99EC" },
  { id: "toy_hammer", name: "뿅망치", costKernel: 500, emoji: "🔨", accent: "#A4A1FF" },
  { id: "birthday_cake", name: "생일케이크", costKernel: 1000, emoji: "🎂", accent: "#FFC785" },
  { id: "heart_balloon", name: "하트풍선", costKernel: 1000, emoji: "🎈", accent: "#FF5E84" },
  { id: "kiss", name: "키스", costKernel: 2000, emoji: "💋", accent: "#FF7B9D" },
  { id: "arrow", name: "화살", costKernel: 2000, emoji: "🏹", accent: "#A8C3FF" },
  { id: "crystal_rose", name: "크리스탈 로즈", costKernel: 3000, emoji: "💎", accent: "#90E5FF" },
  { id: "magic_wand", name: "마법지팡이", costKernel: 5000, emoji: "🪄", accent: "#C8A3FF" },
  { id: "teddy_bear", name: "곰인형", costKernel: 10000, emoji: "🧸", accent: "#C8A66A" },
  { id: "bouquet", name: "꽃다발", costKernel: 20000, emoji: "💐", accent: "#FF8FB2" },
  { id: "ring", name: "반지", costKernel: 50000, emoji: "💍", accent: "#A7F2FF" },
  { id: "supercar", name: "슈퍼카", costKernel: 100000, emoji: "🏎️", accent: "#FF7676" },
  { id: "seal_stamp", name: "인감도장", costKernel: 200000, emoji: "🔏", accent: "#B0B0B0" },
];

const GIFT_MAP: Record<string, GiftItem> = GIFT_CATALOG.reduce((acc, item) => {
  acc[item.id] = item;
  return acc;
}, {} as Record<string, GiftItem>);

export function getGiftById(id: string): GiftItem | null {
  const key = String(id || "").trim();
  return key && GIFT_MAP[key] ? GIFT_MAP[key] : null;
}

