export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type Snapshot = { readonly [key: string]: JsonValue };

export interface AuditActor {
  readonly type: "staff" | "system" | "api_client";
  readonly id: string;
}

export interface AuditRequestMeta {
  readonly requestId: string;
  readonly ipHash?: string;
  readonly userAgent?: string;
}

/**
 * One immutable audit record. There is deliberately no update/delete API anywhere.
 * before=null => create; after=null => delete (soft).
 */
export interface AuditEvent {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actor: AuditActor;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  /** Groups the rows touched by one admin operation; reverted as a unit. */
  readonly operationId: string;
  readonly before: Snapshot | null;
  readonly after: Snapshot | null;
  readonly versionBefore: number | null;
  readonly versionAfter: number | null;
  /** Side effects (emails sent, payments) cannot be undone. */
  readonly revertible: boolean;
  /** Set when this event is itself a revert. */
  readonly revertOf: string | null;
  readonly request: AuditRequestMeta;
  /** sha256(prevHash + canonical(event)) — computed by the writer. */
  readonly prevHash: string | null;
  readonly hash: string | null;
}

/**
 * Append-only writer port. Implementations MUST write in the same transaction as the
 * entity change, and the backing store must refuse updates/deletes for app credentials.
 */
export interface AuditLogWriter {
  append(event: AuditEvent): Promise<void>;
}

export interface AuditLogReader {
  findById(id: string): Promise<AuditEvent | null>;
  findRevertOf(id: string): Promise<AuditEvent | null>;
}
