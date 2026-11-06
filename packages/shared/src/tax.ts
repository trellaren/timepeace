/**
 * US tax-prep categorization. This organizes records for a CPA; it is not tax advice
 * and the app does not file returns. Line references are for the 2025–2026 versions of
 * Schedule C (Form 1040) and Form 1120-S / Form 1125-A; confirm with a tax professional each year.
 */
export interface TaxCategory {
  id: string;
  label: string;
  /** Schedule C line (sole prop / single-member LLC). */
  scheduleC: string;
  /** Form 1120-S line (S corp), or Form 1125-A line for cost of goods sold. */
  form1120S: string;
  /** Job costs that belong in cost of goods sold rather than general deductions. */
  costOfGoodsSold: boolean;
}

export const TAX_CATEGORIES: readonly TaxCategory[] = [
  { id: "job_materials", label: "Job materials & supplies", scheduleC: "Part III, line 38", form1120S: "1125-A line 5 (other costs)", costOfGoodsSold: true },
  { id: "job_subcontractors", label: "Subcontractors (job)", scheduleC: "Part III, line 39", form1120S: "1125-A line 5 (other costs)", costOfGoodsSold: true },
  { id: "job_labor", label: "Direct labor (job)", scheduleC: "Part III, line 37", form1120S: "1125-A line 3", costOfGoodsSold: true },
  { id: "equipment_rental", label: "Equipment rental", scheduleC: "Line 20a", form1120S: "Line 11", costOfGoodsSold: false },
  { id: "small_tools", label: "Small tools & consumables (drill bits, blades)", scheduleC: "Line 22", form1120S: "Line 19 (other deductions)", costOfGoodsSold: false },
  { id: "equipment_purchase", label: "Equipment purchase (depreciable / §179)", scheduleC: "Line 13 (Form 4562)", form1120S: "Line 14 (Form 4562)", costOfGoodsSold: false },
  { id: "vehicle", label: "Vehicle expenses / mileage", scheduleC: "Line 9", form1120S: "Line 19 (other deductions)", costOfGoodsSold: false },
  { id: "fuel", label: "Fuel", scheduleC: "Line 9", form1120S: "Line 19 (other deductions)", costOfGoodsSold: false },
  { id: "insurance", label: "Insurance (GL, builder's risk)", scheduleC: "Line 15", form1120S: "Line 19 (other deductions)", costOfGoodsSold: false },
  { id: "permits_licenses", label: "Permits, licenses & fees", scheduleC: "Line 23", form1120S: "Line 12", costOfGoodsSold: false },
  { id: "professional_services", label: "Legal & professional", scheduleC: "Line 17", form1120S: "Line 19 (other deductions)", costOfGoodsSold: false },
  { id: "office", label: "Office expense & software", scheduleC: "Line 18", form1120S: "Line 19 (other deductions)", costOfGoodsSold: false },
  { id: "repairs", label: "Repairs & maintenance (non-job)", scheduleC: "Line 21", form1120S: "Line 9", costOfGoodsSold: false },
  { id: "advertising", label: "Advertising", scheduleC: "Line 8", form1120S: "Line 16", costOfGoodsSold: false },
  { id: "meals", label: "Business meals (generally 50%)", scheduleC: "Line 24b", form1120S: "Line 19 (other deductions)", costOfGoodsSold: false },
  { id: "travel", label: "Travel", scheduleC: "Line 24a", form1120S: "Line 19 (other deductions)", costOfGoodsSold: false },
  { id: "utilities", label: "Utilities & phones", scheduleC: "Line 25", form1120S: "Line 19 (other deductions)", costOfGoodsSold: false },
  { id: "other", label: "Other", scheduleC: "Line 27a", form1120S: "Line 19 (other deductions)", costOfGoodsSold: false },
];

export function taxCategoryById(id: string): TaxCategory | undefined {
  return TAX_CATEGORIES.find((c) => c.id === id);
}

/** Default tax category for an expense given its job-cost category. */
export function defaultTaxCategoryFor(costCategory: string): string {
  switch (costCategory) {
    case "MATERIAL":
      return "job_materials";
    case "SUB":
      return "job_subcontractors";
    case "EQUIPMENT":
      return "equipment_rental";
    case "LABOR":
      return "job_labor";
    default:
      return "other";
  }
}
