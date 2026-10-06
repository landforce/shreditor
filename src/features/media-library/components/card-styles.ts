/** Shared card wrapper classes for media and composition cards */

export const CARD_GRID_BASE =
  'group relative panel-bg border-2 rounded-lg overflow-hidden transition-colors aspect-square flex flex-col'

/** Grid card whose height comes from its thumbnail's aspect ratio */
export const CARD_GRID_FLOW_BASE =
  'group relative panel-bg border-2 rounded-lg overflow-hidden transition-colors flex flex-col'

export const CARD_LIST_BASE =
  'group panel-bg border rounded overflow-hidden transition-colors flex items-center gap-2 px-2 py-1'

export const CARD_PERF_STYLE = {
  contain: 'layout style paint',
  contentVisibility: 'auto',
} as const
