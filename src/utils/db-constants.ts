// Search & query result limits
export const SEARCH_RESULT_LIMIT = 50;
export const PHRASE_SEARCH_LIMIT = 10;
export const SUGGESTION_LIMIT = 3;

// Default frequency rank for NULL values (appears 5x in db.ts)
export const UNRANKED_FREQUENCY = 999999;

// Levenshtein distance thresholds
export const LEVENSHTEIN_SHORT_THRESHOLD = 1; // for 1-3 char queries
export const LEVENSHTEIN_LONG_THRESHOLD = 2; // for 4+ char queries

// Phrase search parameters
export const PHRASE_TOKEN_MIN_LENGTH = 3;
export const PHRASE_MIN_MATCHES = 2;

// SQLite validation
export const SQLITE_HEADER_SIZE = 16;
