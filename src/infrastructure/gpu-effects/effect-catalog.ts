import { GPU_EFFECT_REGISTRY } from './registry'
import type { EffectParam } from './types'

/** One effect parameter as the agent service describes it (no functions). */
interface EffectCatalogParam {
  type: EffectParam['type']
  label: string
  default: number | boolean | string
  min?: number
  max?: number
  step?: number
  options?: string[]
  animatable?: boolean
}

interface EffectCatalogEntry {
  id: string
  name: string
  category: string
  params: Record<string, EffectCatalogParam>
}

function describeParam(param: EffectParam): EffectCatalogParam {
  return {
    type: param.type,
    label: param.label,
    default: param.default,
    ...(param.min !== undefined ? { min: param.min } : {}),
    ...(param.max !== undefined ? { max: param.max } : {}),
    ...(param.step !== undefined ? { step: param.step } : {}),
    ...(param.options ? { options: param.options.map((option) => option.value) } : {}),
    ...(param.animatable ? { animatable: true } : {}),
  }
}

/**
 * Every registered GPU effect with its parameters, sorted by id. The agent
 * service ships this as headless/lib/effect-catalog.json (kept in sync by
 * effect-catalog.test.ts) so agents can read names, ranges and defaults.
 */
export function buildEffectCatalog(): EffectCatalogEntry[] {
  return [...GPU_EFFECT_REGISTRY.values()]
    .map((effect) => ({
      id: effect.id,
      name: effect.name,
      category: effect.category,
      params: Object.fromEntries(
        Object.entries(effect.params).map(([key, param]) => [key, describeParam(param)]),
      ),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
