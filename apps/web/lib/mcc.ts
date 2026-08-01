/**
 * Curated human-readable merchant categories mapped to MCC codes (OT-021).
 * The user picks categories; the mandate stores the raw MCC allowlist.
 */
export interface MccCategory {
  key: string;
  label: string;
  mccs: string[];
}

export const MCC_CATEGORIES: MccCategory[] = [
  {
    key: 'office_electronics',
    label: 'Office & electronics',
    mccs: ['5943', '5111', '5732', '5734', '5045'],
  },
  { key: 'food_grocery', label: 'Food & grocery', mccs: ['5411', '5499', '5462'] },
  { key: 'restaurants_delivery', label: 'Restaurants & delivery', mccs: ['5812', '5814'] },
  { key: 'books_media', label: 'Books & media', mccs: ['5942', '5735'] },
  { key: 'home_hardware', label: 'Home & hardware', mccs: ['5200', '5211', '5712'] },
  { key: 'clothing', label: 'Clothing', mccs: ['5651', '5691'] },
  { key: 'digital_services', label: 'Digital services & software', mccs: ['5817', '5818', '7372'] },
  { key: 'travel_transport', label: 'Travel & transport', mccs: ['4111', '4121', '4511', '7011'] },
];

export function mccsForCategories(keys: string[]): string[] {
  const set = new Set<string>();
  for (const key of keys) {
    const cat = MCC_CATEGORIES.find((c) => c.key === key);
    if (!cat) throw new Error(`unknown category: ${key}`);
    for (const mcc of cat.mccs) set.add(mcc);
  }
  return [...set].sort();
}
