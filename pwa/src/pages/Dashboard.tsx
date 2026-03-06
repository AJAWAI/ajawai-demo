import { type FormEvent, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { MANAGER_NAME, SECRETARY_NAME } from "../constants/module3";
import { useAjawaiSystem } from "../hooks/useAjawaiSystem";

interface DashboardProps {
  session: Session;
}

export default function Dashboard({ session }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<
    | "Chat"
    | "History"
    | "Projects"
    | "Tasks"
    | "Notes"
    | "Contacts"
    | "Agents"
    | "Approvals"
    | "Settings"
  >("Chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [command, setCommand] = useState("");

  const {
    user,
    busy,
    snapshot,
    syncState,
    pendingSync,
    gmailStatus,
    phiStatus,
    toast,
    activeConversationId,
    activeConversationMessages,
    runCommand,
    approve,
    reject,
    syncNow,
    refreshGmailStatus,
    connectGmail,
    createConversation,
    selectConversation,
    clearToast,
    logout
  } = useAjawaiSystem(session);

  const pendingApprovals = useMemo(
    () => snapshot.approvals.filter((approval) => approval.status === "pending"),
    [snapshot.approvals]
  );

  const recentProjects = useMemo(() => snapshot.projects.slice(0, 3), [snapshot.projects]);
  const approvalConversationId = activeConversationId ?? snapshot.conversations[0]?.id ?? "";

  const submitCommand = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!command.trim() || !activeConversationId) {
      return;
    }
    await runCommand(command, activeConversationId);
    setCommand("");
  };

  const startNewChat = async () => {
    const conversationId = await createConversation();
    if (conversationId) {
      setActiveTab("Chat");
      setSidebarOpen(false);
    }
  };

  const selectChat = async (conversationId: string) => {
    await selectConversation(conversationId);
    setActiveTab("Chat");
    setSidebarOpen(false);
  };

  const renderMessageCard = (message: (typeof activeConversationMessages)[number]) => {
    if (message.type === "assistant") {
      return (
        <article className="chat-message assistant" key={message.id}>
          <span className="chat-role">{SECRETARY_NAME}</span>
          <p>{message.content}</p>
        </article>
      );
    }

    if (
      message.role === "secretary_phi" &&
      [
        "informational_answer",
        "action_completed",
        "task_created",
        "project_created",
        "memory_saved",
        "approval_required",
        "error_failure"
      ].includes(message.type)
    ) {
      return (
        <article className={`chat-card secretary ${message.type}`} key={message.id}>
          <strong>{SECRETARY_NAME}</strong>
          <p>{message.content}</p>
        </article>
      );
    }
    if (message.type === "user") {
      return (
        <article className="chat-message user" key={message.id}>
          <span className="chat-role">President</span>
          <p>{message.content}</p>
        </article>
      );
    }

    if (message.type === "approval_request_card") {
      const approvalId =
        typeof message.payload?.approval_id === "string" ? message.payload.approval_id : null;
      return (
        <article className="chat-card approval" key={message.id}>
          <strong>Approval required</strong>
          <p>{message.content}</p>
          {approvalId && (
            <div className="os-row">
              <button
                className="os-button teal"
                type="button"
                onClick={() => void approve(approvalId, approvalConversationId)}
              >
                Approve
              </button>
              <button
                className="os-button ghost"
                type="button"
                onClick={() => void reject(approvalId, approvalConversationId)}
              >
                Reject
              </button>
            </div>
          )}
        </article>
      );
    }

    if (message.type === "system_notice") {
      return (
        <article className="chat-card system" key={message.id}>
          <strong>{MANAGER_NAME}</strong>
          <p>{message.content}</p>
        </article>
      );
    }

    return (
      <article className="chat-card result" key={message.id}>
        <strong>{message.type.replaceAll("_", " ")}</strong>
        <p>{message.content}</p>
      </article>
    );
  };

  return (
    <main className="os-shell">
      <aside className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        <div className="sidebar-panel">
          <button className="os-button gold" type="button" onClick={() => void startNewChat()}>
            New Chat
          </button>
          <nav className="sidebar-nav">
            {(
              [
                "Chat",
                "History",
                "Projects",
                "Tasks",
                "Notes",
                "Contacts",
                "Agents",
                "Approvals",
                "Settings"
              ] as const
            ).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`sidebar-item ${activeTab === tab ? "active" : ""}`}
                onClick={() => {
                  setActiveTab(tab);
                  setSidebarOpen(false);
                }}
              >
                {tab === "History" ? "Chat History / Conversations" : tab}
              </button>
            ))}
          </nav>
          <div className="sidebar-history">
            <h3>Conversations</h3>
            <ul className="os-list">
              {snapshot.conversations.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    className={`conversation-item ${
                      activeConversationId === conversation.id ? "active" : ""
                    }`}
                    type="button"
                    onClick={() => void selectChat(conversation.id)}
                  >
                    <span>{conversation.title}</span>
                    <small>{new Date(conversation.last_message_at).toLocaleDateString()}</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      <header className="os-header">
        <button className="menu-button" type="button" onClick={() => setSidebarOpen(true)}>
          ☰
        </button>
        <div>
          <h1>AJAWAI OS</h1>
          <p>President Console • {user.email ?? "Signed in"}</p>
        </div>
        <span className={`online-pill ${navigator.onLine ? "on" : "off"}`}>
          {navigator.onLine ? "Online" : "Offline"}
        </span>
      </header>

      <section className="os-content">
        {toast && (
          <article className={`toast ${toast.kind}`}>
            <p>{toast.message}</p>
            <button type="button" onClick={clearToast}>
              Dismiss
            </button>
          </article>
        )}

        {activeTab === "Chat" && (
          <div className="stack">
            <article className="os-card chat-thread">
              {activeConversationMessages.map((message) => renderMessageCard(message))}
              {activeConversationMessages.length === 0 && (
                <article className="chat-message assistant">
                  <span className="chat-role">{SECRETARY_NAME}</span>
                  <p>Hello President. I am ready to coordinate with {MANAGER_NAME}.</p>
                </article>
              )}
            </article>

            <form className="chat-composer" onSubmit={submitCommand}>
              <textarea
                className="os-input"
                rows={2}
                placeholder='Message Secretary Phi... (e.g. "Email 10 electricians asking for quotes.")'
                value={command}
                onChange={(event) => setCommand(event.target.value)}
              />
              <button className="os-button gold" type="submit" disabled={busy || !activeConversationId}>
                {busy ? "Thinking..." : "Send"}
              </button>
            </form>
          </div>
        )}

        {activeTab === "History" && (
          <article className="os-card">
            <h2>Conversations</h2>
            <ul className="os-list">
              {snapshot.conversations.map((conversation) => (
                <li key={conversation.id} className="os-list-item">
                  <p>{conversation.title}</p>
                  <small>{new Date(conversation.last_message_at).toLocaleString()}</small>
                  <div className="os-row">
                    <button
                      className="os-button teal"
                      type="button"
                      onClick={() => void selectChat(conversation.id)}
                    >
                      Open Chat
                    </button>
                  </div>
                </li>
              ))}
              {snapshot.conversations.length === 0 && (
                <li className="os-list-item empty">No chats yet.</li>
              )}
            </ul>
          </article>
        )}

        {activeTab === "Projects" && (
          <div className="stack">
            <article className="os-card">
              <h2>Projects</h2>
              <div className="os-row">
                <button
                  className="os-button gold"
                  type="button"
                  onClick={() => setActiveTab("Chat")}
                >
                  Ask Secretary to create project
                </button>
              </div>
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
              <h2>Tasks</h2>
              <div className="os-row">
                <button
                  className="os-button gold"
                  type="button"
                  onClick={() => setActiveTab("Chat")}
                >
                  Ask Secretary to create task
                </button>
              </div>
              <ul className="os-list">
                {snapshot.tasks.map((task) => (
                  <li key={task.id} className="os-list-item">
                    <p>{task.title}</p>
                    <small>
                      {task.priority} • {task.status}
                    </small>
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
          <article className="os-card">
            <h2>Notes</h2>
            <div className="os-row">
              <button className="os-button gold" type="button" onClick={() => setActiveTab("Chat")}>
                Ask Secretary to save a note
              </button>
            </div>
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
        )}

        {activeTab === "Contacts" && (
          <article className="os-card">
            <h2>Contacts</h2>
            <div className="os-row">
              <button className="os-button gold" type="button" onClick={() => setActiveTab("Chat")}>
                Ask Secretary to add contact
              </button>
            </div>
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
                {activeConversationMessages.map((msg) => (
                  <li key={msg.id} className="os-list-item">
                    <p>{msg.content}</p>
                    <small>
                      {msg.role.replace("_", " ")} • {msg.type}
                    </small>
                  </li>
                ))}
                {activeConversationMessages.length === 0 && (
                  <li className="os-list-item empty">No agent conversation yet.</li>
                )}
              </ul>
            </article>
          </div>
        )}

        {activeTab === "Approvals" && (
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
                      onClick={() => void approve(approval.id, approvalConversationId)}
                    >
                      Approve
                    </button>
                    <button
                      className="os-button ghost"
                      type="button"
                      onClick={() => void reject(approval.id, approvalConversationId)}
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
                  Sync: {syncState.state.replaceAll("_", " ")} • {syncState.detail} •{" "}
                  {new Date(syncState.at).toLocaleTimeString()}
                </small>
              )}
              {!syncState && (
                <small>
                  Sync: {pendingSync ? "pending sync" : "offline cache only"}
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
              <h2>Recent Projects</h2>
              <ul className="os-list">
                {recentProjects.map((project) => (
                  <li key={project.id} className="os-list-item">
                    <p>{project.name}</p>
                    <small>{project.status}</small>
                  </li>
                ))}
              </ul>
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
    </main>
  );
}
