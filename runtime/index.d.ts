export type Network = 'base' | 'solana';
export interface Model {
  id: string; name: string; owned_by?: string; description?: string;
  categories: string[]; billing_mode: string; available?: boolean;
  pricing: Record<string, any>; context_window?: number; max_output?: number;
  /** Actual release date (YYYY-MM-DD), never the gateway's placeholder created. */
  release_date?: string;
}
export interface TokenPrice { input: number; output: number; perCall?: number }
export interface Projection {
  groups: {id: string; title: string; models: Model[]}[];
  shortcuts: Record<string, string>; pricing: Record<string, TokenPrice>; virtualEntries: string[];
}
export interface CatalogState extends Projection {
  network: Network; version: string; models: Model[]; source: string; lastError?: string;
}
export interface CatalogOptions {
  network?: Network; catalogUrl?: string; gatewayUrl?: string;
  timeoutMs?: number; ttlMs?: number; now?: () => number; fetch?: typeof fetch; snapshot?: any;
}
export function validateModels(rows: unknown): Model[];
/** Sort one provider by release date when complete, otherwise by generation; returns a copy. */
export function sortModelsNewestFirst<T extends {id: string; release_date?: string}>(models: readonly T[]): T[];
export function projectCatalog(models: Model[], policy: any): Projection;
export function createCatalogClient(options?: CatalogOptions): {
  current(): CatalogState;
  subscribe(listener: (state: CatalogState) => void): () => void;
  refresh(options?: {force?: boolean}): Promise<CatalogState>;
};
