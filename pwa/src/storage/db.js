import Dexie from "dexie";
class AjawaiDb extends Dexie {
    contacts;
    timeline;
    memory;
    constructor() {
        super("ajawai-demo-db");
        this.version(1).stores({
            contacts: "id, email, createdAt",
            timeline: "id, jobId, createdAt, kind",
            memory: "id, key, createdAt"
        });
    }
}
export const db = new AjawaiDb();
