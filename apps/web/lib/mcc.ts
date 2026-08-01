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

/**
 * MCC -> Stripe Issuing category enum (OT-031). Stripe spending_controls
 * take category names, not raw MCC codes; this maps every MCC used by the
 * curated categories above. Unknown MCCs are simply omitted from card
 * controls (the mandate-level MCC check still applies server-side).
 */
export const MCC_TO_STRIPE_CATEGORY: Record<string, string> = {
  '5943': 'stationary_stores_office_and_school_supply_stores',
  '5111': 'stationery_office_supplies_printing_and_writing_paper',
  '5732': 'electronics_stores',
  '5734': 'computer_software_stores',
  '5045': 'computers_peripherals_and_software',
  '5411': 'grocery_stores_supermarkets',
  '5499': 'miscellaneous_food_stores',
  '5462': 'bakeries',
  '5812': 'eating_places_restaurants',
  '5814': 'fast_food_restaurants',
  '5942': 'book_stores',
  '5735': 'record_stores',
  '5200': 'home_supply_warehouse_stores',
  '5211': 'lumber_building_materials_stores',
  '5712': 'furniture_home_furnishings_and_equipment_stores_except_appliances',
  '5651': 'family_clothing_stores',
  '5691': 'mens_and_womens_clothing_stores',
  '5817': 'digital_goods_applications',
  '5818': 'digital_goods_large_volume',
  '7372': 'computer_programming',
  '4111': 'commuter_transport_and_ferries',
  '4121': 'taxicabs_limousines',
  '4511': 'airlines_air_carriers',
  '7011': 'hotels_motels_and_resorts',
};

export function stripeCategoriesForMccs(mccs: string[]): string[] {
  return [...new Set(mccs.map((m) => MCC_TO_STRIPE_CATEGORY[m]).filter((c): c is string => !!c))];
}

export function mccsForCategories(keys: string[]): string[] {
  const set = new Set<string>();
  for (const key of keys) {
    const cat = MCC_CATEGORIES.find((c) => c.key === key);
    if (!cat) throw new Error(`unknown category: ${key}`);
    for (const mcc of cat.mccs) set.add(mcc);
  }
  return [...set].sort();
}
