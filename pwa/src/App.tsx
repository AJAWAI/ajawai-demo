import { FormEvent, useMemo, useState } from "react";
import "./styles.css";
import { useJobKernel } from "./kernel/useJobKernel";

type Tab = "Chat" | "People" | "Projects" | "Timeline" | "Settings";

const tabs: Tab[] = ["Chat", "People", "Projects", "Timeline", "Settings"];

const formatTime = (dateString: string) =>
  new Date(dateString).toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric"
  });

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("Chat");
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [memoryKey, setMemoryKey] = useState("");
  const [memoryValue, setMemoryValue] = useState("");
  const [memoryQuery, setMemoryQuery] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [chatMessage, setChatMessage] = useState<string | null>(null);

  const {
    relayBaseUrl,
    jobs,
    approvals,
    timeline,
    contacts,
    memoryResults,
    createSendEmailJob,
    addContact,
    saveMemory,
    searchMemory,
    approveRequest,
    rejectRequest,
    clearLocalData
  } = useJobKernel();

  const pendingApprovals = useMemo(() => {
    return approvals.filter((request) => request.status === "pending");
  }, [approvals]);

  const submitEmailJob = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!emailTo || !emailSubject || !emailBody) {
      setChatMessage("Please provide to, subject, and body.");
      return;
    }

    await createSendEmailJob({ to: emailTo, subject: emailSubject, body: emailBody });
    setEmailTo("");
    setEmailSubject("");
    setEmailBody("");
    setChatMessage("Send email job created and waiting for approval.");
  };

  const submitMemorySave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!memoryKey || !memoryValue) {
      setChatMessage("Memory key and value are required.");
      return;
    }
    const result = await saveMemory(memoryKey, memoryValue);
    setChatMessage(result.ok ? "Memory saved." : `Memory save failed: ${result.error}`);
    if (result.ok) {
      setMemoryKey("");
      setMemoryValue("");
    }
  };

  const submitMemorySearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!memoryQuery) {
      setChatMessage("Memory search query is required.");
      return;
    }
    const result = await searchMemory(memoryQuery);
    setChatMessage(result.ok ? "Memory search complete." : `Memory search failed: ${result.error}`);
  };

  const submitContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!contactName || !contactEmail) {
      return;
    }
    await addContact({
      name: contactName,
      email: contactEmail
    });
    setContactName("");
    setContactEmail("");
  };

  return (
    <main className="app-shell">
      <header className="top-bar">
        <h1>AJAWAI Demo</h1>
        <p>Local-first agent kernel with approvals + timeline</p>
      </header>

      <section className="content">
        {activeTab === "Chat" && (
          <div className="stack">
            <article className="card">
              <h2>Create send_email job</h2>
              <form className="stack" onSubmit={submitEmailJob}>
                <input
                  className="input"
                  placeholder="To"
                  value={emailTo}
                  onChange={(event) => setEmailTo(event.target.value)}
                />
                <input
                  className="input"
                  placeholder="Subject"
                  value={emailSubject}
                  onChange={(event) => setEmailSubject(event.target.value)}
                />
                <textarea
                  className="input"
                  rows={4}
                  placeholder="Email body"
                  value={emailBody}
                  onChange={(event) => setEmailBody(event.target.value)}
                />
                <button className="button" type="submit">
                  Queue job (requires approval)
                </button>
              </form>
            </article>

            <article className="card">
              <h2>memory.save</h2>
              <form className="stack" onSubmit={submitMemorySave}>
                <input
                  className="input"
                  placeholder="Memory key"
                  value={memoryKey}
                  onChange={(event) => setMemoryKey(event.target.value)}
                />
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Memory value"
                  value={memoryValue}
                  onChange={(event) => setMemoryValue(event.target.value)}
                />
                <button className="button secondary" type="submit">
                  Save memory
                </button>
              </form>
            </article>

            <article className="card">
              <h2>memory.search</h2>
              <form className="row" onSubmit={submitMemorySearch}>
                <input
                  className="input"
                  placeholder="Search memory"
                  value={memoryQuery}
                  onChange={(event) => setMemoryQuery(event.target.value)}
                />
                <button className="button secondary" type="submit">
                  Search
                </button>
              </form>
              <ul className="list">
                {memoryResults.map((result) => (
                  <li key={result.id} className="list-item">
                    <strong>{result.key}</strong>
                    <p>{result.value}</p>
                  </li>
                ))}
              </ul>
            </article>

            <article className="card">
              <h2>Jobs</h2>
              <ul className="list">
                {jobs.map((job) => (
                  <li key={job.id} className="list-item">
                    <div className="row spaced">
                      <strong>{job.title}</strong>
                      <span className={`status status-${job.status}`}>{job.status}</span>
                    </div>
                    <small>{formatTime(job.updatedAt)}</small>
                  </li>
                ))}
                {jobs.length === 0 && <li className="list-item muted">No jobs yet.</li>}
              </ul>
            </article>
          </div>
        )}

        {activeTab === "People" && (
          <div className="stack">
            <article className="card">
              <h2>Add contact</h2>
              <form className="stack" onSubmit={submitContact}>
                <input
                  className="input"
                  placeholder="Name"
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                />
                <input
                  className="input"
                  placeholder="Email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                />
                <button className="button secondary" type="submit">
                  Save contact
                </button>
              </form>
            </article>
            <article className="card">
              <h2>Saved contacts</h2>
              <ul className="list">
                {contacts.map((contact) => (
                  <li key={contact.id} className="list-item">
                    <strong>{contact.name}</strong>
                    <p>{contact.email}</p>
                  </li>
                ))}
                {contacts.length === 0 && (
                  <li className="list-item muted">No contacts in IndexedDB yet.</li>
                )}
              </ul>
            </article>
          </div>
        )}

        {activeTab === "Projects" && (
          <div className="stack">
            <article className="card">
              <h2>Projects</h2>
              <p>
                Local demo projects are managed with the same kernel and timeline primitives.
              </p>
              <ul className="list">
                <li className="list-item">
                  <strong>Client onboarding</strong>
                  <p>Draft kickoff summary and prepare team intro email.</p>
                </li>
                <li className="list-item">
                  <strong>Roadmap review</strong>
                  <p>Gather stakeholder notes and store key memory snippets.</p>
                </li>
              </ul>
            </article>
          </div>
        )}

        {activeTab === "Timeline" && (
          <div className="stack">
            <article className="card">
              <h2>Kernel timeline</h2>
              <ul className="list">
                {timeline.map((entry) => (
                  <li key={entry.id} className="list-item">
                    <div className="row spaced">
                      <span>{entry.message}</span>
                      <small>{formatTime(entry.createdAt)}</small>
                    </div>
                    <small className={`status status-${entry.kind}`}>{entry.kind}</small>
                  </li>
                ))}
                {timeline.length === 0 && (
                  <li className="list-item muted">No timeline events yet.</li>
                )}
              </ul>
            </article>
          </div>
        )}

        {activeTab === "Settings" && (
          <div className="stack">
            <article className="card">
              <h2>Approvals</h2>
              <ul className="list">
                {pendingApprovals.map((approval) => (
                  <li key={approval.id} className="list-item">
                    <p>
                      <strong>{approval.toolCall.name}</strong>
                    </p>
                    <small>{approval.reason}</small>
                    <div className="row">
                      <button
                        className="button"
                        onClick={() => void approveRequest(approval.id)}
                        type="button"
                      >
                        Approve
                      </button>
                      <button
                        className="button danger"
                        onClick={() => void rejectRequest(approval.id)}
                        type="button"
                      >
                        Reject
                      </button>
                    </div>
                  </li>
                ))}
                {pendingApprovals.length === 0 && (
                  <li className="list-item muted">No pending approvals.</li>
                )}
              </ul>
            </article>

            <article className="card">
              <h2>Runtime config</h2>
              <p>
                Relay base URL: <code>{relayBaseUrl}</code>
              </p>
              <button className="button danger" type="button" onClick={() => void clearLocalData()}>
                Clear IndexedDB data
              </button>
            </article>
          </div>
        )}
      </section>

      {chatMessage && <p className="flash">{chatMessage}</p>}

      <nav className="tab-bar" aria-label="Primary">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            {tab}
          </button>
        ))}
      </nav>
    </main>
  );
}
