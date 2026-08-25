import { createHash, timingSafeEqual } from "node:crypto";
import { POSTBOX_CURSOR_MAX_LENGTH } from "@pi-postbox/protocol";

const CURSOR_VERSION = 2;
const QUERY_DIGEST_BYTES = 16;
const HEADER_BYTES = 1 + QUERY_DIGEST_BYTES;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export class PaginationCursorError extends Error {
  constructor() {
    super("Pagination cursor is invalid or belongs to another query");
    this.name = "PaginationCursorError";
  }
}

export function encodePaginationCursor(query: unknown, boundary: unknown): string {
  const body = Buffer.from(JSON.stringify(boundary), "utf8");
  const encoded = Buffer.concat([
    Buffer.from([CURSOR_VERSION]),
    queryDigest(query),
    body
  ]).toString("base64url");
  if (encoded.length > POSTBOX_CURSOR_MAX_LENGTH) throw new PaginationCursorError();
  return encoded;
}

export function decodePaginationCursor(cursor: string, query: unknown): unknown {
  if (!cursor || cursor.length > POSTBOX_CURSOR_MAX_LENGTH || !BASE64URL_PATTERN.test(cursor)) {
    throw new PaginationCursorError();
  }
  const decoded = Buffer.from(cursor, "base64url");
  if (decoded.length <= HEADER_BYTES || decoded[0] !== CURSOR_VERSION) throw new PaginationCursorError();
  const expected = queryDigest(query);
  const actual = decoded.subarray(1, HEADER_BYTES);
  if (!timingSafeEqual(actual, expected)) throw new PaginationCursorError();
  try {
    return JSON.parse(decoded.subarray(HEADER_BYTES).toString("utf8"));
  } catch {
    throw new PaginationCursorError();
  }
}

function queryDigest(query: unknown): Buffer {
  return createHash("sha256").update(JSON.stringify(query)).digest().subarray(0, QUERY_DIGEST_BYTES);
}
