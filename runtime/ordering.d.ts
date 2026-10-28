/** True for a valid YYYY-MM-DD release date. */
export function isReleaseDate(value: unknown): value is string;
/** Sort one provider by release date when complete, otherwise by generation; returns a copy. */
export function sortModelsNewestFirst<T extends {id: string; release_date?: string}>(models: readonly T[]): T[];
