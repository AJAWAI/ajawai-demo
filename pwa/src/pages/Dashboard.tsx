import { type FormEvent, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Task } from "@ajawai/shared";
import { MANAGER_NAME, SECRETARY_NAME } from "../constants/module3";
import { useAjawaiSystem } from "../hooks/useAjawaiSystem";

interface DashboardProps {
  session: Session;
}

export default function Dashboard({ session }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<
    "Home" | "Projects" | "Tasks" | "Notes" | "Contacts" | "Agents" | "Settings"
  >("Home");
  const [command, setCommand] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskPriority, setTaskPriority] = useState<Task["priority"]>("medium");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactCompany, setContactCompany] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const {
    user,
    busy,
    snapshot,
    syncState,
    gmailStatus,
    phiStatus,
    runCommand,
    approve,
    reject,
    setTaskStatus,
    syncNow,
    refreshGmailStatus,
    connectGmail,
    logout
  } = useAjawaiSystem(session);

  const pendingApprovals = useMemo(
    () => snapshot.approvals.filter((approval) => approval.status === "pending"),
    [snapshot.approvals]
  );

  const recentProjects = useMemo(() => snapshot.projects.slice(0, 3), [snapshot.projects]);
  const recentNotes = useMemo(() => snapshot.notes.slice(0, 3), [snapshot.notes]);
  const openTasks = useMemo(
    () => snapshot.tasks.filter((task) => task.status !== "done").slice(0, 5),
    [snapshot.tasks]
  );
  const recentTimeline = useMemo(() => snapshot.timeline.slice(0, 8), [snapshot.timeline]);
  const recentMessages = useMemo(() => snapshot.messages.slice(0, 12), [snapshot.messages]);

  const submitCommand = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!command.trim()) {
      return;
    }
    await runCommand(command);
    setCommand("");
  };

  const submitProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectName.trim()) {
      return;
    }
    await runCommand(
      `Create project "${projectName.trim()}". Description: ${projectDescription.trim()}`
    );
    setProjectName("");
    setProjectDescription("");
  };

  const submitTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!taskTitle.trim()) {
      return;
    }
    await runCommand(
      `Create task "${taskTitle.trim()}" with ${taskPriority} priority. Details: ${taskDescription.trim()}`
    );
    setTaskTitle("");
    setTaskDescription("");
    setTaskPriority("medium");
  };

  const submitNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!noteTitle.trim() || !noteContent.trim()) {
      return;
    }
    await runCommand(
      `Create note titled "${noteTitle.trim()}". Content: ${noteContent.trim()}`
    );
    setNoteTitle("");
    setNoteContent("");
  };

  const submitContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!contactName.trim() || !contactEmail.trim()) {
      return;
    }
    await runCommand(
      `Create contact ${contactName.trim()} with email ${contactEmail.trim()} and company ${contactCompany.trim()} phone ${contactPhone.trim()}`
    );
    setContactName("");
    setContactEmail("");
    setContactCompany("");
    setContactPhone("");
  };

  return (
    <main className="os-shell">
      <header className="os-header">
        <div>
          <h1>AJAWAI OS</h1>
          <p>President Console • {user.email ?? "Signed in"}</p>
        </div>
        <span className={`online-pill ${navigator.onLine ? "on" : "off"}`}>
          {navigator.onLine ? "Online" : "Offline"}
        </span>
      </header>

      <section className="os-content">
        {activeTab === "Home" && (
          <div className="stack">
            <article className="os-card">
              <h2>Quick Command • {SECRETARY_NAME}</h2>
              <form className="stack" onSubmit={submitCommand}>
                <textarea
                  className="os-input"
                  rows={3}
                  placeholder='Example: "Email 10 electricians asking for quotes."'
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                />
                <button className="os-button gold" type="submit" disabled={busy}>
                  {busy ? "Processing..." : "Send to Secretary Phi"}
                </button>
              </form>
            </article>

            <article className="os-card">
              <h2>Approval Center</h2>
              <ul className="os-list">
                {pendingApprovals.map((approval) => (
                  <li key={approval.id} className="os-list-item">
                    <p>{approval.action_type}</p>
                    <small>{new Date(approval.created_at).toLocaleString()}</small>
                    <div className="os-row">
                      <button
                        className="os-button teal"
                        type="button"
                        onClick={() => void approve(approval.id)}
                      >
                        Approve
                      </button>
                      <button
                        className="os-button ghost"
                        type="button"
                        onClick={() => void reject(approval.id)}
                      >
                        Reject
                      </button>
                    </div>
                  </li>
                ))}
                {pendingApprovals.length === 0 && (
                  <li className="os-list-item empty">No approvals pending.</li>
                )}
              </ul>
            </article>

            <div className="dashboard-grid">
              <article className="os-card">
                <h3>Recent Projects</h3>
                <ul className="os-list">
                  {recentProjects.map((project) => (
                    <li key={project.id} className="os-list-item">
                      <p>{project.name}</p>
                      <small>{project.status}</small>
                    </li>
                  ))}
                  {recentProjects.length === 0 && (
                    <li className="os-list-item empty">No projects yet.</li>
                  )}
                </ul>
              </article>

              <article className="os-card">
                <h3>Tasks Due</h3>
                <ul className="os-list">
                  {openTasks.map((task) => (
                    <li key={task.id} className="os-list-item">
                      <p>{task.title}</p>
                      <small>
                        {task.status} • {task.priority}
                      </small>
                    </li>
                  ))}
                  {openTasks.length === 0 && (
                    <li className="os-list-item empty">No open tasks.</li>
                  )}
                </ul>
              </article>
            </div>

            <div className="dashboard-grid">
              <article className="os-card">
                <h3>Agent Activity</h3>
                <ul className="os-list">
                  {recentMessages.slice(0, 5).map((msg) => (
                    <li key={msg.id} className="os-list-item">
                      <p>{msg.content}</p>
                      <small>{msg.role.replace("_", " ")}</small>
                    </li>
                  ))}
                  {recentMessages.length === 0 && (
                    <li className="os-list-item empty">No agent messages yet.</li>
                  )}
                </ul>
              </article>

              <article className="os-card">
                <h3>Recent Notes</h3>
                <ul className="os-list">
                  {recentNotes.map((note) => (
                    <li key={note.id} className="os-list-item">
                      <p>{note.title}</p>
                      <small>{new Date(note.created_at).toLocaleDateString()}</small>
                    </li>
                  ))}
                  {recentNotes.length === 0 && (
                    <li className="os-list-item empty">No notes yet.</li>
                  )}
                </ul>
              </article>
            </div>

            <article className="os-card">
              <h3>Timeline / Activity Log</h3>
              <ul className="os-list">
                {recentTimeline.map((event) => (
                  <li key={event.id} className="os-list-item">
                    <p>{event.description}</p>
                    <small>
                      {event.event_type} • {new Date(event.created_at).toLocaleString()}
                    </small>
                  </li>
                ))}
                {recentTimeline.length === 0 && (
                  <li className="os-list-item empty">No activity yet.</li>
                )}
              </ul>
            </article>
          </div>
        )}

        {activeTab === "Projects" && (
          <div className="stack">
            <article className="os-card">
              <h2>Create Project</h2>
              <form className="stack" onSubmit={submitProject}>
                <input
                  className="os-input"
                  value={projectName}
                  placeholder="Project name"
                  onChange={(event) => setProjectName(event.target.value)}
                />
                <textarea
                  className="os-input"
                  rows={3}
                  value={projectDescription}
                  placeholder="Project description"
                  onChange={(event) => setProjectDescription(event.target.value)}
                />
                <button className="os-button gold" type="submit" disabled={busy}>
                  Save project
                </button>
              </form>
            </article>
            <article className="os-card">
              <h2>Projects</h2>
              <ul className="os-list">
                {snapshot.projects.map((project) => (
                  <li key={project.id} className="os-list-item">
                    <p>{project.name}</p>
                    <small>{project.status}</small>
                  </li>
                ))}
                {snapshot.projects.length === 0 && (
                  <li className="os-list-item empty">No projects yet.</li>
                )}
              </ul>
            </article>
          </div>
        )}

        {activeTab === "Tasks" && (
          <div className="stack">
            <article className="os-card">
              <h2>Create Task</h2>
              <form className="stack" onSubmit={submitTask}>
                <input
                  className="os-input"
                  value={taskTitle}
                  placeholder="Task title"
                  onChange={(event) => setTaskTitle(event.target.value)}
                />
                <textarea
                  className="os-input"
                  rows={3}
                  value={taskDescription}
                  placeholder="Task description"
                  onChange={(event) => setTaskDescription(event.target.value)}
                />
                <select
                  className="os-input"
                  value={taskPriority}
                  onChange={(event) => setTaskPriority(event.target.value as Task["priority"])}
                >
                  <option value="low">Low priority</option>
                  <option value="medium">Medium priority</option>
                  <option value="high">High priority</option>
                </select>
                <button className="os-button gold" type="submit" disabled={busy}>
                  Save task
                </button>
              </form>
            </article>

            <article className="os-card">
              <h2>Tasks</h2>
              <ul className="os-list">
                {snapshot.tasks.map((task) => (
                  <li key={task.id} className="os-list-item">
                    <p>{task.title}</p>
                    <small>
                      {task.priority} • {task.status}
                    </small>
                    <div className="os-row">
                      <button
                        className="os-button ghost"
                        type="button"
                        onClick={() => void setTaskStatus(task.id, "in_progress")}
                      >
                        In progress
                      </button>
                      <button
                        className="os-button teal"
                        type="button"
                        onClick={() => void setTaskStatus(task.id, "done")}
                      >
                        Done
                      </button>
                    </div>
                  </li>
                ))}
                {snapshot.tasks.length === 0 && (
                  <li className="os-list-item empty">No tasks yet.</li>
                )}
              </ul>
            </article>
          </div>
        )}

        {activeTab === "Notes" && (
          <div className="stack">
            <article className="os-card">
              <h2>Create Note</h2>
              <form className="stack" onSubmit={submitNote}>
                <input
                  className="os-input"
                  value={noteTitle}
                  placeholder="Note title"
                  onChange={(event) => setNoteTitle(event.target.value)}
                />
                <textarea
                  className="os-input"
                  rows={4}
                  value={noteContent}
                  placeholder="Write note"
                  onChange={(event) => setNoteContent(event.target.value)}
                />
                <button className="os-button gold" type="submit" disabled={busy}>
                  Save note
                </button>
              </form>
            </article>
            <article className="os-card">
              <h2>Notes</h2>
              <ul className="os-list">
                {snapshot.notes.map((note) => (
                  <li key={note.id} className="os-list-item">
                    <p>{note.title}</p>
                    <small>{note.content.slice(0, 120)}</small>
                  </li>
                ))}
                {snapshot.notes.length === 0 && (
                  <li className="os-list-item empty">No notes yet.</li>
                )}
              </ul>
            </article>
          </div>
        )}

        {activeTab === "Contacts" && (
          <div className="stack">
            <article className="os-card">
              <h2>Add Contact</h2>
              <form className="stack" onSubmit={submitContact}>
                <input
                  className="os-input"
                  value={contactName}
                  placeholder="Name"
                  onChange={(event) => setContactName(event.target.value)}
                />
                <input
                  className="os-input"
                  value={contactEmail}
                  placeholder="Email"
                  onChange={(event) => setContactEmail(event.target.value)}
                />
                <input
                  className="os-input"
                  value={contactCompany}
                  placeholder="Company"
                  onChange={(event) => setContactCompany(event.target.value)}
                />
                <input
                  className="os-input"
                  value={contactPhone}
                  placeholder="Phone"
                  onChange={(event) => setContactPhone(event.target.value)}
                />
                <button className="os-button gold" type="submit" disabled={busy}>
                  Save contact
                </button>
              </form>
            </article>
            <article className="os-card">
              <h2>Contacts</h2>
              <ul className="os-list">
                {snapshot.contacts.map((contact) => (
                  <li key={contact.id} className="os-list-item">
                    <p>{contact.name}</p>
                    <small>
                      {contact.email}
                      {contact.company ? ` • ${contact.company}` : ""}
                    </small>
                  </li>
                ))}
                {snapshot.contacts.length === 0 && (
                  <li className="os-list-item empty">No contacts yet.</li>
                )}
              </ul>
            </article>
          </div>
        )}

        {activeTab === "Agents" && (
          <div className="stack">
            <article className="os-card">
              <h2>Agent Architecture</h2>
              <p>President interacts only with Secretary Phi.</p>
              <ul className="os-list">
                <li className="os-list-item">
                  <p>{SECRETARY_NAME}</p>
                  <small>
                    Runtime: {phiStatus.runtime} • Model: {phiStatus.model}
                  </small>
                </li>
                <li className="os-list-item">
                  <p>{MANAGER_NAME}</p>
                  <small>Execution engine online for tasks, approvals, memory, timeline.</small>
                </li>
              </ul>
            </article>

            <article className="os-card">
              <h2>Agent Conversation Log</h2>
              <ul className="os-list">
                {snapshot.messages.map((msg) => (
                  <li key={msg.id} className="os-list-item">
                    <p>{msg.content}</p>
                    <small>{msg.role.replace("_", " ")}</small>
                  </li>
                ))}
                {snapshot.messages.length === 0 && (
                  <li className="os-list-item empty">No agent conversation yet.</li>
                )}
              </ul>
            </article>
          </div>
        )}

        {activeTab === "Settings" && (
          <div className="stack">
            <article className="os-card">
              <h2>Sync</h2>
              <p>
                Local-first mode active. Supabase sync is optional and uses last-write-wins on
                <code> updated_at </code>.
              </p>
              <div className="os-row">
                <button className="os-button teal" type="button" onClick={() => void syncNow()}>
                  Sync now
                </button>
                <button
                  className="os-button ghost"
                  type="button"
                  onClick={() => void refreshGmailStatus()}
                >
                  Refresh Gmail status
                </button>
              </div>
              {syncState && (
                <small>
                  {syncState.detail} • {new Date(syncState.at).toLocaleTimeString()}
                </small>
              )}
            </article>

            <article className="os-card">
              <h2>Gmail Connector</h2>
              <p>
                Status: {gmailStatus.connected ? "Connected" : "Not connected"} ({gmailStatus.mode}
                )
              </p>
              <small>{gmailStatus.detail}</small>
              <div className="os-row">
                <button className="os-button gold" type="button" onClick={() => void connectGmail()}>
                  Connect Gmail OAuth
                </button>
              </div>
            </article>

            <article className="os-card">
              <h2>Account</h2>
              <button className="os-button ghost" type="button" onClick={() => void logout()}>
                Logout
              </button>
            </article>
          </div>
        )}
      </section>

      <nav className="os-tabbar">
        {(
          ["Home", "Projects", "Tasks", "Notes", "Contacts", "Agents", "Settings"] as const
        ).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`os-tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>
    </main>
  );
}
