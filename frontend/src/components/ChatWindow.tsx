import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { Message } from "../lib/api";
import { getDisplayName } from "../lib/display";

type ChatWindowProps = {
  contactName: string | null;
  phone: string | null;
  messages: Message[];
  messageText: string;
  loading: boolean;
  sending: boolean;
  onChangeMessage: (value: string) => void;
  onSend: () => void;
  onSendAttachment: (file: File, caption: string) => Promise<void> | void;
  onSendLocation: (payload: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  }) => Promise<void> | void;
};

type AttachmentTab = "image" | "document" | "location";

const quickRepliesStorageKey = "whatsapp-crm.quick-replies";
const defaultQuickReplies = [
  "Thanks for reaching out. I will get back to you shortly.",
  "Can you share your preferred package or budget?",
  "I have noted your request and will update you soon."
];

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatStatus(message: Message) {
  if (message.direction !== "outgoing") {
    return "";
  }

  if (message.send_status === "sending") {
    return "Sending";
  }

  if (message.send_status === "failed") {
    return "Failed";
  }

  if (message.send_status === "read") {
    return "Read";
  }

  if (message.send_status === "delivered") {
    return "Delivered";
  }

  if (message.send_status === "sent") {
    return "Sent";
  }

  return "Queued";
}

function ActionIcon(props: { children: ReactNode }) {
  return <span className="flex h-4 w-4 items-center justify-center">{props.children}</span>;
}

export function ChatWindow(props: ChatWindowProps) {
  const {
    contactName,
    phone,
    messages,
    messageText,
    loading,
    sending,
    onChangeMessage,
    onSend,
    onSendAttachment,
    onSendLocation
  } = props;
  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const stickToBottomRef = useRef(true);
  const lastPhoneRef = useRef<string | null>(null);
  const lastMessageKeyRef = useRef<string>("");
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [attachmentTab, setAttachmentTab] = useState<AttachmentTab>("image");
  const [quickReplies, setQuickReplies] = useState<string[]>(defaultQuickReplies);
  const [newQuickReply, setNewQuickReply] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [attachmentCaption, setAttachmentCaption] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [composerError, setComposerError] = useState("");

  function updateStickToBottom() {
    const container = listRef.current;
    if (!container) {
      return;
    }

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }

  useEffect(() => {
    const raw = window.localStorage.getItem(quickRepliesStorageKey);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        setQuickReplies(parsed);
      }
    } catch {
      window.localStorage.removeItem(quickRepliesStorageKey);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(quickRepliesStorageKey, JSON.stringify(quickReplies));
  }, [quickReplies]);

  useEffect(() => {
    const changedConversation = lastPhoneRef.current !== phone;
    const lastMessage = messages[messages.length - 1];
    const nextMessageKey = lastMessage ? `${lastMessage.id}:${lastMessage.created_at}` : "";
    const hasNewLastMessage = nextMessageKey !== lastMessageKeyRef.current;

    lastPhoneRef.current = phone;
    lastMessageKeyRef.current = nextMessageKey;

    if (changedConversation) {
      stickToBottomRef.current = true;
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
      setShowQuickReplies(false);
      setShowAttachmentMenu(false);
      setSelectedFile(null);
      setAttachmentCaption("");
      setComposerError("");
      return;
    }

    if (hasNewLastMessage && stickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, phone]);

  function handleAddQuickReply() {
    const value = newQuickReply.trim();
    if (!value) {
      return;
    }

    if (quickReplies.includes(value)) {
      setNewQuickReply("");
      return;
    }

    setQuickReplies((current) => [value, ...current].slice(0, 12));
    setNewQuickReply("");
  }

  function handlePickQuickReply(value: string) {
    onChangeMessage(messageText ? `${messageText} ${value}` : value);
    setShowQuickReplies(false);
  }

  function handleDeleteQuickReply(value: string) {
    setQuickReplies((current) => current.filter((item) => item !== value));
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    setComposerError("");
  }

  async function handleSendSelectedAttachment() {
    if (!selectedFile) {
      setComposerError("Pick a file first.");
      return;
    }

    try {
      setComposerError("");
      await onSendAttachment(selectedFile, attachmentCaption);
      setSelectedFile(null);
      setAttachmentCaption("");
      setShowAttachmentMenu(false);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Failed to send attachment.");
    }
  }

  async function handleSendCurrentLocation() {
    if (!navigator.geolocation) {
      setComposerError("Geolocation is not supported on this device.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setComposerError("");
      },
      () => {
        setComposerError("Unable to get your current location.");
      },
      {
        enableHighAccuracy: true,
        timeout: 10000
      }
    );
  }

  async function handleSendLocationClick() {
    const lat = Number(latitude);
    const lng = Number(longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setComposerError("Enter valid latitude and longitude values.");
      return;
    }

    try {
      setComposerError("");
      await onSendLocation({
        latitude: lat,
        longitude: lng,
        name: locationName.trim() || undefined,
        address: locationAddress.trim() || undefined
      });
      setLocationName("");
      setLocationAddress("");
      setLatitude("");
      setLongitude("");
      setShowAttachmentMenu(false);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Failed to send location.");
    }
  }

  if (!phone) {
    return (
      <section className="glass-panel flex min-h-[420px] items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <p className="text-sm uppercase tracking-[0.25em] text-slate-500">No active chat</p>
          <h3 className="mt-3 text-2xl font-semibold text-ink">Pick a conversation</h3>
          <p className="mt-3 text-sm text-slate-500">
            Select a contact from the left panel to review history and send a reply.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="glass-panel flex min-h-[520px] flex-col overflow-visible p-4 xl:max-h-[calc(100dvh-210px)]">
      <div className="mb-3 rounded-[26px] border border-white/45 bg-white/40 px-4 py-3 shadow-soft">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Active conversation</p>
        <h3 className="mt-1 text-xl font-semibold text-ink">{getDisplayName(contactName, phone)}</h3>
        <p className="mt-1 text-sm text-slate-400">{phone}</p>
      </div>

      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-[28px] border border-white/35 bg-white/18 p-4"
        onScroll={updateStickToBottom}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading messages...</div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            No messages in this conversation yet.
          </div>
        ) : (
          messages.map((item) => (
            <div
              key={item.id}
              className={`flex ${item.direction === "outgoing" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-[24px] px-4 py-3 shadow-soft ${
                  item.direction === "outgoing"
                    ? "bg-gradient-to-br from-sky-400 to-cyan-300 text-white"
                    : "bg-white/75 text-slate-700"
                }`}
              >
                <p className="text-sm leading-6">{item.message}</p>
                <p
                  className={`mt-2 text-right text-[11px] ${
                    item.direction === "outgoing" ? "text-white/75" : "text-slate-400"
                  }`}
                >
                  {item.direction === "outgoing"
                    ? `${formatTime(item.created_at)} | ${formatStatus(item)}`
                    : formatTime(item.created_at)}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="relative z-10 mt-3 space-y-2">
        {showQuickReplies ? (
          <div className="rounded-[26px] border border-white/45 bg-white/55 p-3 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink">Quick replies</p>
              <button
                className="text-xs font-medium text-slate-400 transition hover:text-slate-600"
                onClick={() => setShowQuickReplies(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <div className="mt-3 max-h-36 overflow-y-auto pr-1">
              <div className="flex flex-wrap gap-2">
              {quickReplies.map((reply) => (
                <div key={reply} className="flex items-center gap-1 rounded-full bg-white/75 pr-1 shadow-soft">
                  <button
                    className="rounded-full px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-white"
                    onClick={() => handlePickQuickReply(reply)}
                    type="button"
                  >
                    {reply}
                  </button>
                  <button
                    aria-label={`Delete quick reply: ${reply}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-white hover:text-rose-500"
                    onClick={() => handleDeleteQuickReply(reply)}
                    type="button"
                  >
                    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
                      <path
                        d="M18 6 6 18M6 6l12 12"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </svg>
                  </button>
                </div>
              ))}
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <input
                className="input-glass"
                onChange={(event) => setNewQuickReply(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleAddQuickReply();
                  }
                }}
                placeholder="Add a new quick reply..."
                value={newQuickReply}
              />
              <button className="secondary-button min-w-[110px]" onClick={handleAddQuickReply} type="button">
                Save reply
              </button>
            </div>
          </div>
        ) : null}

        {showAttachmentMenu ? (
          <div className="rounded-[26px] border border-white/45 bg-white/55 p-3 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink">Attachments</p>
              <button
                className="text-xs font-medium text-slate-400 transition hover:text-slate-600"
                onClick={() => setShowAttachmentMenu(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {([
                { key: "image", label: "Picture" },
                { key: "document", label: "Document" },
                { key: "location", label: "Location" }
              ] as const).map((item) => (
                <button
                  key={item.key}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    attachmentTab === item.key
                      ? "bg-gradient-to-r from-sky-400 to-cyan-300 text-white shadow-soft"
                      : "bg-white/70 text-slate-500 hover:bg-white"
                  }`}
                  onClick={() => {
                    setAttachmentTab(item.key);
                    setComposerError("");
                  }}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>

            {attachmentTab !== "location" ? (
              <div className="mt-3 space-y-3">
                <input
                  accept={attachmentTab === "image" ? "image/*" : ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"}
                  className="hidden"
                  onChange={handleFileSelection}
                  ref={attachmentTab === "image" ? imageInputRef : documentInputRef}
                  type="file"
                />
                <div className="rounded-[22px] bg-white/70 p-3 text-sm text-slate-600">
                  {selectedFile ? `Selected: ${selectedFile.name}` : `No ${attachmentTab} selected yet.`}
                </div>
                <div className="flex gap-2">
                  <button
                    className="secondary-button"
                    onClick={() =>
                      (attachmentTab === "image" ? imageInputRef.current : documentInputRef.current)?.click()
                    }
                    type="button"
                  >
                    Choose {attachmentTab === "image" ? "picture" : "document"}
                  </button>
                  {selectedFile ? (
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setSelectedFile(null);
                        setAttachmentCaption("");
                      }}
                      type="button"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                <input
                  className="input-glass"
                  onChange={(event) => setAttachmentCaption(event.target.value)}
                  placeholder="Optional caption..."
                  value={attachmentCaption}
                />
                <button className="primary-button" disabled={sending} onClick={handleSendSelectedAttachment} type="button">
                  {sending ? "Sending..." : `Send ${attachmentTab === "image" ? "picture" : "document"}`}
                </button>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    className="input-glass"
                    onChange={(event) => setLatitude(event.target.value)}
                    placeholder="Latitude"
                    value={latitude}
                  />
                  <input
                    className="input-glass"
                    onChange={(event) => setLongitude(event.target.value)}
                    placeholder="Longitude"
                    value={longitude}
                  />
                </div>
                <input
                  className="input-glass"
                  onChange={(event) => setLocationName(event.target.value)}
                  placeholder="Place name"
                  value={locationName}
                />
                <input
                  className="input-glass"
                  onChange={(event) => setLocationAddress(event.target.value)}
                  placeholder="Address"
                  value={locationAddress}
                />
                <div className="flex flex-wrap gap-2">
                  <button className="secondary-button" onClick={handleSendCurrentLocation} type="button">
                    Use current location
                  </button>
                  <button className="primary-button" disabled={sending} onClick={handleSendLocationClick} type="button">
                    {sending ? "Sending..." : "Send location"}
                  </button>
                </div>
              </div>
            )}

            {composerError ? <p className="mt-3 text-sm text-rose-500">{composerError}</p> : null}
          </div>
        ) : null}

        <div className="rounded-[26px] border border-white/45 bg-white/40 p-2 shadow-soft">
          <div className="flex items-center gap-2">
          <button
            className={`secondary-button flex h-12 w-12 items-center justify-center rounded-2xl p-0 ${
              showQuickReplies ? "bg-white text-slate-700" : ""
            }`}
            onClick={() => {
              setShowQuickReplies((current) => !current);
              setShowAttachmentMenu(false);
              setComposerError("");
            }}
            title="Quick replies"
            type="button"
          >
            <ActionIcon>
              <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
                <path
                  d="M7 10h10M7 14h6m-7 7 3.6-3H18a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H6A3 3 0 0 0 3 7v8a3 3 0 0 0 3 3v3Z"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            </ActionIcon>
          </button>

          <button
            className={`secondary-button flex h-12 w-12 items-center justify-center rounded-2xl p-0 ${
              showAttachmentMenu ? "bg-white text-slate-700" : ""
            }`}
            onClick={() => {
              setShowAttachmentMenu((current) => !current);
              setShowQuickReplies(false);
              setComposerError("");
            }}
            title="Attachments and location"
            type="button"
          >
            <ActionIcon>
              <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
                <path
                  d="m21.4 11.1-8.5 8.5a5 5 0 0 1-7.1-7.1l9.2-9.2a3.5 3.5 0 0 1 5 5L10.5 17.8a2 2 0 1 1-2.8-2.8l8-8"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            </ActionIcon>
          </button>

          <input
            className="input-glass"
            onChange={(event) => onChangeMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder="Type your reply..."
            value={messageText}
          />
          <button className="primary-button min-w-[120px]" disabled={sending} onClick={onSend} type="button">
            {sending ? "Sending..." : "Send"}
          </button>
          </div>
        </div>
      </div>
    </section>
  );
}
