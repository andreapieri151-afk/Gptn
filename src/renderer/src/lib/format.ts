/** Turns an API model id into something readable when no label is available. */
export function formatModelName(id: string): string {
  const match = /^gemini-([\d.]+)-(.+)$/.exec(id)
  if (match) {
    const [, version, rest] = match
    const name = rest
      .split('-')
      .map((part) => (part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
      .join(' ')
    return `Gemini ${version} ${name}`
  }
  return id.replace(/^models\//, '')
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatRelativeDate(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const days = Math.floor(diffMs / 86_400_000)
  if (days <= 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  if (days < 7) return date.toLocaleDateString([], { weekday: 'long' })
  return date.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
}

export type DateBucket = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Previous 30 days' | 'Older'

/** Groups conversations the way a native macOS list would. */
export function bucketFor(iso: string): DateBucket {
  const date = new Date(iso)
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const dayMs = 86_400_000
  const diff = startOfToday.getTime() - date.getTime()
  if (diff < 0) return 'Today'
  if (diff < dayMs) return 'Yesterday'
  if (diff < 7 * dayMs) return 'Previous 7 days'
  if (diff < 30 * dayMs) return 'Previous 30 days'
  return 'Older'
}

export const BUCKET_ORDER: DateBucket[] = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older']

export function groupByBucket<T extends { updatedAt: string }>(items: T[]): Array<{ bucket: DateBucket; items: T[] }> {
  const groups = new Map<DateBucket, T[]>()
  for (const item of items) {
    const bucket = bucketFor(item.updatedAt)
    const list = groups.get(bucket)
    if (list) list.push(item)
    else groups.set(bucket, [item])
  }
  return BUCKET_ORDER.filter((bucket) => groups.has(bucket)).map((bucket) => ({
    bucket,
    items: groups.get(bucket) as T[]
  }))
}
