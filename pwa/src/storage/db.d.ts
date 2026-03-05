import Dexie, { type EntityTable } from "dexie";
export interface Contact {
    id: string;
    name: string;
    email: string;
    createdAt: string;
}
export interface TimelineEntry {
    id: string;
    jobId?: string;
    message: string;
    createdAt: string;
    kind: "info" | "approval" | "tool" | "error";
}
export interface MemoryEntry {
    id: string;
    key: string;
    value: string;
    createdAt: string;
}
declare class AjawaiDb extends Dexie {
    contacts: EntityTable<Contact, "id">;
    timeline: EntityTable<TimelineEntry, "id">;
    memory: EntityTable<MemoryEntry, "id">;
    constructor();
}
export declare const db: AjawaiDb;
export {};
