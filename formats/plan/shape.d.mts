// Types for ./shape.mjs.

export interface PlanIssue {
  /** A beat or line id, or 'plan'. */
  where: string
  message: string
}

export interface IssueList {
  errors: PlanIssue[]
  warnings: PlanIssue[]
  error(where: string, message: string): void
  warn(where: string, message: string): void
}

export function issueList(): IssueList
export const isInt: (value: unknown) => value is number
export const isText: (value: unknown) => value is string
export const trimmed: (value: unknown) => string
export const plain: (value: unknown) => string
export const isObject: (value: unknown) => value is Record<string, unknown>
export const firstProblem: (rules: Array<[unknown, string]>) => string | null
