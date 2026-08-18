// Append-only: index N is version N+1, and a migration that has shipped is never edited —
// edit it and every existing database silently disagrees with every fresh one. Applied
// versions live in the `migrations` table (see db.ts).
//
// Empty at milestone 1 on purpose: the skeleton owns no tables. Feature milestones append.

export const MIGRATIONS: readonly string[] = []
