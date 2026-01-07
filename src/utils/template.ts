export type TemplateValue = string | number

export function formatTemplate(template: string, values: Record<string, TemplateValue>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = values[key]
    return value === undefined || value === null ? '' : String(value)
  })
}
