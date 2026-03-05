import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import "./styles.css";
import { useJobKernel } from "./kernel/useJobKernel";
const tabs = ["Chat", "People", "Projects", "Timeline", "Settings"];
const formatTime = (dateString) => new Date(dateString).toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric"
});
export default function App() {
    const [activeTab, setActiveTab] = useState("Chat");
    const [emailTo, setEmailTo] = useState("");
    const [emailSubject, setEmailSubject] = useState("");
    const [emailBody, setEmailBody] = useState("");
    const [memoryKey, setMemoryKey] = useState("");
    const [memoryValue, setMemoryValue] = useState("");
    const [memoryQuery, setMemoryQuery] = useState("");
    const [contactName, setContactName] = useState("");
    const [contactEmail, setContactEmail] = useState("");
    const [chatMessage, setChatMessage] = useState(null);
    const { relayBaseUrl, jobs, approvals, timeline, contacts, memoryResults, createSendEmailJob, addContact, saveMemory, searchMemory, approveRequest, rejectRequest, clearLocalData } = useJobKernel();
    const pendingApprovals = useMemo(() => {
        return approvals.filter((request) => request.status === "pending");
    }, [approvals]);
    const submitEmailJob = async (event) => {
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
    const submitMemorySave = async (event) => {
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
    const submitMemorySearch = async (event) => {
        event.preventDefault();
        if (!memoryQuery) {
            setChatMessage("Memory search query is required.");
            return;
        }
        const result = await searchMemory(memoryQuery);
        setChatMessage(result.ok ? "Memory search complete." : `Memory search failed: ${result.error}`);
    };
    const submitContact = async (event) => {
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
    return (_jsxs("main", { className: "app-shell", children: [_jsxs("header", { className: "top-bar", children: [_jsx("h1", { children: "AJAWAI Demo" }), _jsx("p", { children: "Local-first agent kernel with approvals + timeline" })] }), _jsxs("section", { className: "content", children: [activeTab === "Chat" && (_jsxs("div", { className: "stack", children: [_jsxs("article", { className: "card", children: [_jsx("h2", { children: "Create send_email job" }), _jsxs("form", { className: "stack", onSubmit: submitEmailJob, children: [_jsx("input", { className: "input", placeholder: "To", value: emailTo, onChange: (event) => setEmailTo(event.target.value) }), _jsx("input", { className: "input", placeholder: "Subject", value: emailSubject, onChange: (event) => setEmailSubject(event.target.value) }), _jsx("textarea", { className: "input", rows: 4, placeholder: "Email body", value: emailBody, onChange: (event) => setEmailBody(event.target.value) }), _jsx("button", { className: "button", type: "submit", children: "Queue job (requires approval)" })] })] }), _jsxs("article", { className: "card", children: [_jsx("h2", { children: "memory.save" }), _jsxs("form", { className: "stack", onSubmit: submitMemorySave, children: [_jsx("input", { className: "input", placeholder: "Memory key", value: memoryKey, onChange: (event) => setMemoryKey(event.target.value) }), _jsx("textarea", { className: "input", rows: 3, placeholder: "Memory value", value: memoryValue, onChange: (event) => setMemoryValue(event.target.value) }), _jsx("button", { className: "button secondary", type: "submit", children: "Save memory" })] })] }), _jsxs("article", { className: "card", children: [_jsx("h2", { children: "memory.search" }), _jsxs("form", { className: "row", onSubmit: submitMemorySearch, children: [_jsx("input", { className: "input", placeholder: "Search memory", value: memoryQuery, onChange: (event) => setMemoryQuery(event.target.value) }), _jsx("button", { className: "button secondary", type: "submit", children: "Search" })] }), _jsx("ul", { className: "list", children: memoryResults.map((result) => (_jsxs("li", { className: "list-item", children: [_jsx("strong", { children: result.key }), _jsx("p", { children: result.value })] }, result.id))) })] }), _jsxs("article", { className: "card", children: [_jsx("h2", { children: "Jobs" }), _jsxs("ul", { className: "list", children: [jobs.map((job) => (_jsxs("li", { className: "list-item", children: [_jsxs("div", { className: "row spaced", children: [_jsx("strong", { children: job.title }), _jsx("span", { className: `status status-${job.status}`, children: job.status })] }), _jsx("small", { children: formatTime(job.updatedAt) })] }, job.id))), jobs.length === 0 && _jsx("li", { className: "list-item muted", children: "No jobs yet." })] })] })] })), activeTab === "People" && (_jsxs("div", { className: "stack", children: [_jsxs("article", { className: "card", children: [_jsx("h2", { children: "Add contact" }), _jsxs("form", { className: "stack", onSubmit: submitContact, children: [_jsx("input", { className: "input", placeholder: "Name", value: contactName, onChange: (event) => setContactName(event.target.value) }), _jsx("input", { className: "input", placeholder: "Email", value: contactEmail, onChange: (event) => setContactEmail(event.target.value) }), _jsx("button", { className: "button secondary", type: "submit", children: "Save contact" })] })] }), _jsxs("article", { className: "card", children: [_jsx("h2", { children: "Saved contacts" }), _jsxs("ul", { className: "list", children: [contacts.map((contact) => (_jsxs("li", { className: "list-item", children: [_jsx("strong", { children: contact.name }), _jsx("p", { children: contact.email })] }, contact.id))), contacts.length === 0 && (_jsx("li", { className: "list-item muted", children: "No contacts in IndexedDB yet." }))] })] })] })), activeTab === "Projects" && (_jsx("div", { className: "stack", children: _jsxs("article", { className: "card", children: [_jsx("h2", { children: "Projects" }), _jsx("p", { children: "Local demo projects are managed with the same kernel and timeline primitives." }), _jsxs("ul", { className: "list", children: [_jsxs("li", { className: "list-item", children: [_jsx("strong", { children: "Client onboarding" }), _jsx("p", { children: "Draft kickoff summary and prepare team intro email." })] }), _jsxs("li", { className: "list-item", children: [_jsx("strong", { children: "Roadmap review" }), _jsx("p", { children: "Gather stakeholder notes and store key memory snippets." })] })] })] }) })), activeTab === "Timeline" && (_jsx("div", { className: "stack", children: _jsxs("article", { className: "card", children: [_jsx("h2", { children: "Kernel timeline" }), _jsxs("ul", { className: "list", children: [timeline.map((entry) => (_jsxs("li", { className: "list-item", children: [_jsxs("div", { className: "row spaced", children: [_jsx("span", { children: entry.message }), _jsx("small", { children: formatTime(entry.createdAt) })] }), _jsx("small", { className: `status status-${entry.kind}`, children: entry.kind })] }, entry.id))), timeline.length === 0 && (_jsx("li", { className: "list-item muted", children: "No timeline events yet." }))] })] }) })), activeTab === "Settings" && (_jsxs("div", { className: "stack", children: [_jsxs("article", { className: "card", children: [_jsx("h2", { children: "Approvals" }), _jsxs("ul", { className: "list", children: [pendingApprovals.map((approval) => (_jsxs("li", { className: "list-item", children: [_jsx("p", { children: _jsx("strong", { children: approval.toolCall.name }) }), _jsx("small", { children: approval.reason }), _jsxs("div", { className: "row", children: [_jsx("button", { className: "button", onClick: () => void approveRequest(approval.id), type: "button", children: "Approve" }), _jsx("button", { className: "button danger", onClick: () => void rejectRequest(approval.id), type: "button", children: "Reject" })] })] }, approval.id))), pendingApprovals.length === 0 && (_jsx("li", { className: "list-item muted", children: "No pending approvals." }))] })] }), _jsxs("article", { className: "card", children: [_jsx("h2", { children: "Runtime config" }), _jsxs("p", { children: ["Relay base URL: ", _jsx("code", { children: relayBaseUrl })] }), _jsx("button", { className: "button danger", type: "button", onClick: () => void clearLocalData(), children: "Clear IndexedDB data" })] })] }))] }), chatMessage && _jsx("p", { className: "flash", children: chatMessage }), _jsx("nav", { className: "tab-bar", "aria-label": "Primary", children: tabs.map((tab) => (_jsx("button", { className: `tab ${activeTab === tab ? "active" : ""}`, onClick: () => setActiveTab(tab), type: "button", children: tab }, tab))) })] }));
}
