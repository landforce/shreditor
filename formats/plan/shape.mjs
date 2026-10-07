// Small shared pieces of the plan readers (./schema.mjs, ./performance/read.mjs).

/** Collects errors and warnings, each tied to a beat or line id, or 'plan'. */
export function issueList() {
  const errors = []
  const warnings = []
  return {
    errors,
    warnings,
    error: (where, message) => errors.push({ where, message }),
    warn: (where, message) => warnings.push({ where, message }),
  }
}

export const isInt = (value) => Number.isInteger(value)
export const isText = (value) => typeof value === 'string' && value.trim().length > 0
export const trimmed = (value) => (isText(value) ? value.trim() : '')
export const plain = (value) => (typeof value === 'string' ? value : '')
export const isObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** The first message whose rule is broken: `[[broken, message], ...]`, else null. */
export const firstProblem = (rules) => rules.find(([broken]) => broken)?.[1] ?? null
