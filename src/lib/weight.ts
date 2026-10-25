// Weights are integer grams everywhere. Display uses integer maths only.

/** 850 → "850 g", 12345 → "12.35 kg" (rounded half up to 10 g). */
export function formatWeight(grams: number): string {
  if (!Number.isSafeInteger(grams)) throw new Error(`Weight must be integer grams, got ${grams}`);
  if (grams < 1000) return `${grams} g`;
  const tensOfGrams = Math.floor((grams + 5) / 10);
  const kg = Math.floor(tensOfGrams / 100);
  return `${kg.toLocaleString("en-NG")}.${String(tensOfGrams % 100).padStart(2, "0")} kg`;
}

/** L × W × H in mm, e.g. "320 × 240 × 180 mm". */
export function formatDimensions(l: number | null, w: number | null, h: number | null): string | null {
  if (!l || !w || !h) return null;
  return `${l} × ${w} × ${h} mm`;
}
