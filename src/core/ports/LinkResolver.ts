export interface LinkResolver {
  resolve(code: string): Promise<string | null>
  create(url: string, meta: Record<string, string>): Promise<string>
}
