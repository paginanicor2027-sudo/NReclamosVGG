const categories = ["baches", "luminarias", "residuos", "desagues", "otros"] as const;

export type Category = typeof categories[number];

export function isCategory(value: unknown): value is Category {
  return categories.some((category) => category === value);
}
