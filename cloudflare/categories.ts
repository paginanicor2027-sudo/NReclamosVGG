import { isCategory } from "../supabase/functions/_shared/report-category.ts";

const specificCategories: ReadonlySet<string> = new Set([
  "agua", "ambiente", "arbolado", "cableado", "cloacas", "comercios", "educacion",
  "electricidad", "espacios_publicos", "gas", "plagas", "salud", "seguridad",
  "tramites", "transito", "veredas",
]);

export function isWorkerCategory(value: unknown): value is string {
  return typeof value === "string" && (isCategory(value) || specificCategories.has(value));
}
