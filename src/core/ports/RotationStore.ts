export type RotationCursor = {
  roundRobinIndex: number
  lastSource: string | null
}

export interface RotationStore {
  load(tenantId: string): Promise<RotationCursor>
  save(tenantId: string, cursor: RotationCursor): Promise<void>
  reset(tenantId: string): Promise<void>
}
