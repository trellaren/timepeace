/**
 * Starting data for a new company: cost codes and project templates. Used by the demo seed and by
 * create-org. Companies edit these afterwards.
 */
export const COST_CODES = [
  ["01", "General Conditions"],
  ["02", "Sitework & Excavation"],
  ["03", "Concrete & Foundation"],
  ["06", "Framing"],
  ["07", "Roofing & Siding"],
  ["08", "Windows & Doors"],
  ["15", "Plumbing"],
  ["16", "Electrical"],
  ["23", "HVAC"],
  ["09", "Drywall"],
  ["10", "Finishes & Trim"],
] as const;

export type TemplateTask = { title: string; costCode: string; estimatedMinutes: number; estimatedMaterialCents: number };
export const NEW_BUILD_TEMPLATE: { name: string; tasks: TemplateTask[] }[] = [
  {
    name: "Site & Foundation",
    tasks: [
      { title: "Stake lot & set grade", costCode: "02", estimatedMinutes: 16 * 60, estimatedMaterialCents: 40000 },
      { title: "Excavate footings", costCode: "02", estimatedMinutes: 24 * 60, estimatedMaterialCents: 0 },
      { title: "Form & pour footings", costCode: "03", estimatedMinutes: 40 * 60, estimatedMaterialCents: 850000 },
      { title: "Foundation walls & waterproofing", costCode: "03", estimatedMinutes: 48 * 60, estimatedMaterialCents: 1200000 },
    ],
  },
  {
    name: "Framing",
    tasks: [
      { title: "Sill plate & floor system", costCode: "06", estimatedMinutes: 40 * 60, estimatedMaterialCents: 900000 },
      { title: "Frame exterior walls", costCode: "06", estimatedMinutes: 64 * 60, estimatedMaterialCents: 1400000 },
      { title: "Frame interior walls", costCode: "06", estimatedMinutes: 48 * 60, estimatedMaterialCents: 600000 },
      { title: "Set roof trusses & sheathing", costCode: "06", estimatedMinutes: 56 * 60, estimatedMaterialCents: 1500000 },
      { title: "Install windows & exterior doors", costCode: "08", estimatedMinutes: 24 * 60, estimatedMaterialCents: 1800000 },
    ],
  },
  {
    name: "Rough-ins",
    tasks: [
      { title: "Plumbing rough-in", costCode: "15", estimatedMinutes: 40 * 60, estimatedMaterialCents: 450000 },
      { title: "Electrical rough-in", costCode: "16", estimatedMinutes: 48 * 60, estimatedMaterialCents: 500000 },
      { title: "HVAC rough-in", costCode: "23", estimatedMinutes: 32 * 60, estimatedMaterialCents: 650000 },
      { title: "Rough-in inspection prep", costCode: "01", estimatedMinutes: 8 * 60, estimatedMaterialCents: 0 },
    ],
  },
  {
    name: "Close-in",
    tasks: [
      { title: "Roofing", costCode: "07", estimatedMinutes: 40 * 60, estimatedMaterialCents: 1100000 },
      { title: "Insulation", costCode: "09", estimatedMinutes: 16 * 60, estimatedMaterialCents: 380000 },
      { title: "Hang & finish drywall", costCode: "09", estimatedMinutes: 64 * 60, estimatedMaterialCents: 520000 },
    ],
  },
  {
    name: "Finishes",
    tasks: [
      { title: "Interior trim & doors", costCode: "10", estimatedMinutes: 48 * 60, estimatedMaterialCents: 650000 },
      { title: "Cabinets & countertops", costCode: "10", estimatedMinutes: 24 * 60, estimatedMaterialCents: 2200000 },
      { title: "Final punch list", costCode: "01", estimatedMinutes: 16 * 60, estimatedMaterialCents: 50000 },
    ],
  },
];

export const KITCHEN_REMODEL_TEMPLATE: { name: string; tasks: TemplateTask[] }[] = [
  {
    name: "Demo & prep",
    tasks: [
      { title: "Protect floors & demo cabinets", costCode: "01", estimatedMinutes: 32 * 60, estimatedMaterialCents: 15000 },
      { title: "Haul-off & dumpster", costCode: "01", estimatedMinutes: 8 * 60, estimatedMaterialCents: 65000 },
    ],
  },
  {
    name: "Rough-ins",
    tasks: [
      { title: "Relocate sink plumbing", costCode: "15", estimatedMinutes: 12 * 60, estimatedMaterialCents: 60000 },
      { title: "New circuits & can lights", costCode: "16", estimatedMinutes: 16 * 60, estimatedMaterialCents: 90000 },
    ],
  },
  {
    name: "Finish",
    tasks: [
      { title: "Patch drywall & paint", costCode: "09", estimatedMinutes: 16 * 60, estimatedMaterialCents: 40000 },
      { title: "Install cabinets", costCode: "10", estimatedMinutes: 24 * 60, estimatedMaterialCents: 1400000 },
      { title: "Countertops & backsplash", costCode: "10", estimatedMinutes: 16 * 60, estimatedMaterialCents: 650000 },
    ],
  },
];

export const DEFAULT_TEMPLATES = [
  { name: "Single-family new build", projectType: "New build", phases: NEW_BUILD_TEMPLATE },
  { name: "Kitchen remodel", projectType: "Remodel", phases: KITCHEN_REMODEL_TEMPLATE },
];
