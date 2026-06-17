export interface Lock {
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T | null>
}
