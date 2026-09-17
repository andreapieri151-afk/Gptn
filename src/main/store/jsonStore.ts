import { constants as fsConstants } from 'node:fs'
import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Minimal, dependency-free persistent JSON store.
 *
 * - writes are atomic (temp file + rename) so a crash never truncates the file
 * - a `.bak` copy is kept so a corrupted file can be recovered automatically
 * - writes are debounced and coalesced to keep the UI thread responsive
 */
export class JsonStore<T extends object> {
  private readonly file: string
  private readonly backupFile: string
  private readonly defaults: () => T
  private readonly normalize: (raw: unknown) => T
  private data: T
  private dirty = false
  private timer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()
  private loaded = false

  constructor(
    file: string,
    defaults: () => T,
    normalize?: (raw: unknown, fallback: T) => T,
    private readonly debounceMs = 250
  ) {
    this.file = file
    this.backupFile = `${file}.bak`
    this.defaults = defaults
    this.normalize = (raw: unknown) => {
      const fallback = defaults()
      if (!raw || typeof raw !== 'object') return fallback
      if (!normalize) return { ...fallback, ...(raw as object) }
      return normalize(raw, fallback)
    }
    this.data = defaults()
  }

  async load(): Promise<T> {
    const primary = await this.readJson(this.file)
    if (primary.ok) {
      this.data = this.normalize(primary.value)
      this.loaded = true
      return this.data
    }
    const backup = await this.readJson(this.backupFile)
    if (backup.ok) {
      this.data = this.normalize(backup.value)
      this.loaded = true
      // Persist the recovered data immediately.
      this.dirty = true
      await this.flush()
      return this.data
    }
    this.data = this.defaults()
    this.loaded = true
    return this.data
  }

  private async readJson(file: string): Promise<{ ok: true; value: unknown } | { ok: false }> {
    try {
      const text = await readFile(file, 'utf8')
      if (!text.trim()) return { ok: false }
      return { ok: true, value: JSON.parse(text) }
    } catch {
      return { ok: false }
    }
  }

  get isLoaded(): boolean {
    return this.loaded
  }

  get path(): string {
    return this.file
  }

  get(): T {
    return this.data
  }

  set(value: T): void {
    this.data = value
    this.markDirty()
  }

  update(mutator: (draft: T) => void): T {
    mutator(this.data)
    this.markDirty()
    return this.data
  }

  private markDirty(): void {
    this.dirty = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      // A failed background write must never surface as an unhandled rejection;
      // the data stays marked dirty and is retried on the next flush/quit.
      void this.flush().catch(() => undefined)
    }, this.debounceMs)
  }

  /** Writes pending changes right away (used on app quit and before exports). */
  flush(): Promise<void> {
    if (!this.dirty) return this.writing
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.dirty = false
    const payload = JSON.stringify(this.data, null, 2)
    this.writing = this.writing.then(async () => {
      try {
        await mkdir(dirname(this.file), { recursive: true })
        await this.rotateBackup()
        const tmp = `${this.file}.${process.pid}.tmp`
        await writeFile(tmp, payload, 'utf8')
        await rename(tmp, this.file)
      } catch (error) {
        this.dirty = true
        throw error
      }
    })
    return this.writing
  }

  /**
   * Moves the current file aside as the backup copy — but only when it is still
   * valid JSON, so recovering from a corrupt file cannot destroy the backup.
   */
  private async rotateBackup(): Promise<void> {
    try {
      await access(this.file, fsConstants.F_OK)
    } catch {
      return
    }
    const current = await this.readJson(this.file)
    if (!current.ok) return
    try {
      await rename(this.file, this.backupFile)
    } catch {
      /* backup is best effort */
    }
  }

  async sizeBytes(): Promise<number> {
    try {
      const info = await stat(this.file)
      return info.size
    } catch {
      return 0
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
