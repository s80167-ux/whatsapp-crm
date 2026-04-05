import { useEffect, useRef, useState, type ChangeEvent, type ComponentProps, type ReactNode } from "react";
import type { Message } from "../lib/api";
import { CustomerPanel } from "./CustomerPanel";
import { getDisplayName, getDisplayPhone, formatPhoneDisplay } from "../lib/display";

type ChatWindowProps = {
  contactName: string | null;
  phone: string | null;
  chatJid?: string | null;
  profilePictureUrl?: string | null;
  messages: Message[];
  messageText: string;
  loading: boolean;
  sending: boolean;
  customerPanelProps?: ComponentProps<typeof CustomerPanel> | null;
  onChangeMessage: (value: string) => void;
  onSend: () => void;
  onSendQuickReply: (value: string) => Promise<void> | void;
  onSendAttachment: (file: File, caption: string) => Promise<void> | void;
  onSendLocation: (payload: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  }) => Promise<void> | void;
};

type AttachmentTab = "image" | "document" | "location";
type StoredQuickReplyAttachment = {
  name: string;
  type: string;
  dataUrl: string;
};

type QuickReply = {
  id: string;
  text: string;
  attachment?: StoredQuickReplyAttachment | null;
};

const quickRepliesStorageKey = "whatsapp-crm.quick-replies";
const defaultQuickReplies: QuickReply[] = [
  { id: "default-thanks", text: "Thanks for reaching out. I will get back to you shortly." },
  { id: "default-budget", text: "Can you share your preferred package or budget?" },
  { id: "default-update", text: "I have noted your request and will update you soon." }
];
const commonEmojis = ["😀", "😂", "😍", "🙏", "👍", "❤️", "🎉", "😄"];

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

function getQuickReplyContentLabel(reply: QuickReply) {
  if (reply.text.trim()) {
    return reply.text;
  }

  if (reply.attachment?.name) {
    return `[Attachment] ${reply.attachment.name}`;
  }

  return "Quick reply";
}

function getQuickReplyLabel(reply: QuickReply) {
  const compactValue = getQuickReplyContentLabel(reply).trim().replace(/\s+/g, " ");
  if (compactValue.length <= 18) {
    return compactValue;
  }

  const words = compactValue.split(" ");
  const labelWords: string[] = [];

  for (const word of words) {
    const nextLength = labelWords.join(" ").length + word.length + (labelWords.length ? 1 : 0);
    if (labelWords.length === 3 || nextLength > 18) {
      break;
    }

    labelWords.push(word);
  }

  return (labelWords.join(" ") || compactValue.slice(0, 15)).trimEnd() + "...";
}

function normalizeQuickReply(item: unknown, index: number): QuickReply | null {
  if (typeof item === "string") {
    const text = item.trim();
    return text ? { id: `legacy-${index}-${text.slice(0, 12)}`, text } : null;
  }

  if (!item || typeof item !== "object") {
    return null;
  }

  const candidate = item as Partial<QuickReply> & {
    attachment?: Partial<StoredQuickReplyAttachment> | null;
  };
  const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
  const attachment = candidate.attachment;
  const normalizedAttachment = attachment && typeof attachment.name === "string" && typeof attachment.type === "string" && typeof attachment.dataUrl === "string"
    ? {
        name: attachment.name,
        type: attachment.type,
        dataUrl: attachment.dataUrl
      }
    : null;

  if (!text && !normalizedAttachment) {
    return null;
  }

  return {
    id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : `reply-${index}-${Date.now()}`,
    text,
    attachment: normalizedAttachment
  };
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Failed to read attachment."));
    reader.readAsDataURL(file);
  });
}

async function buildStoredQuickReplyAttachment(file: File): Promise<StoredQuickReplyAttachment> {
  return {
    name: file.name,
    type: file.type || "application/octet-stream",
    dataUrl: await readFileAsDataUrl(file)
  };
}

async function storedAttachmentToFile(attachment: StoredQuickReplyAttachment): Promise<File> {
  const response = await fetch(attachment.dataUrl);
  const blob = await response.blob();
  return new File([blob], attachment.name, { type: attachment.type || blob.type || "application/octet-stream" });
}

export function ChatWindow(props: ChatWindowProps) {
  const {
    contactName,
    phone,
    chatJid,
    profilePictureUrl,
    messages,
    messageText,
    loading,
    sending,
    customerPanelProps,
    onChangeMessage,
    onSend,
    onSendQuickReply,
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
  const quickReplyAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [attachmentTab, setAttachmentTab] = useState<AttachmentTab>("image");
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>(defaultQuickReplies);
  const [newQuickReply, setNewQuickReply] = useState("");
  const [newQuickReplyAttachment, setNewQuickReplyAttachment] = useState<StoredQuickReplyAttachment | null>(null);
  const [showQuickReplyEmojiPicker, setShowQuickReplyEmojiPicker] = useState(false);
  const [quickReplyDraftError, setQuickReplyDraftError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [attachmentCaption, setAttachmentCaption] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [composerError, setComposerError] = useState("");
  const [showCustomerProfile, setShowCustomerProfile] = useState(false);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [expandedQuickReplyMessageId, setExpandedQuickReplyMessageId] = useState<string | null>(null);
  const [expandedEmojiMessageId, setExpandedEmojiMessageId] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const displayPhone = getDisplayPhone(phone, chatJid);
  const title = getDisplayName(contactName, displayPhone);
  const avatarLabel = title.slice(0, 2).toUpperCase();
  const visibleMessages = showAllMessages ? messages : messages.slice(-6);
  const hiddenMessageCount = Math.max(messages.length - 6, 0);

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
      if (Array.isArray(parsed)) {
        const normalized = parsed
          .map((item, index) => normalizeQuickReply(item, index))
          .filter((item): item is QuickReply => Boolean(item));

        if (normalized.length > 0) {
          setQuickReplies(normalized);
        }
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
      
      requestAnimationFrame(() => {
        if (listRef.current) {
          listRef.current.scrollTop = listRef.current.scrollHeight;
        }
      });

      setShowQuickReplies(false);
      setShowAttachmentMenu(false);
      setSelectedFile(null);
      setAttachmentCaption("");
      setComposerError("");
      setShowCustomerProfile(false);
      setShowAllMessages(false);
      setExpandedQuickReplyMessageId(null);
      setExpandedEmojiMessageId(null);
      setShowEmojiPicker(false);
      return;
    }

    if (hasNewLastMessage && stickToBottomRef.current) {
      requestAnimationFrame(() => {
        if (listRef.current) {
          listRef.current.scrollTo({
            top: listRef.current.scrollHeight,
            behavior: "smooth"
          });
        }
      });
    }
  }, [messages, phone]);

  function clearQuickReplyDraft() {
    setNewQuickReply("");
    setNewQuickReplyAttachment(null);
    setQuickReplyDraftError("");
    setShowQuickReplyEmojiPicker(false);
  }

  function handleAddQuickReply() {
    const value = newQuickReply.trim();
    if (!value && !newQuickReplyAttachment) {
      setQuickReplyDraftError("Add text, an emoji, or an attachment first.");
      return;
    }

    const alreadyExists = quickReplies.some(
      (reply) =>
        reply.text === value &&
        reply.attachment?.dataUrl === newQuickReplyAttachment?.dataUrl &&
        reply.attachment?.name === newQuickReplyAttachment?.name
    );

    if (alreadyExists) {
      clearQuickReplyDraft();
      return;
    }

    setQuickReplies((current) => [
      {
        id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `reply-${Date.now()}`,
        text: value,
        attachment: newQuickReplyAttachment
      },
      ...current
    ].slice(0, 12));
    clearQuickReplyDraft();
  }

  async function handlePickQuickReply(reply: QuickReply) {
    if (reply.attachment) {
      const file = await storedAttachmentToFile(reply.attachment);
      await onSendAttachment(file, reply.text);
      setShowQuickReplies(false);
      return;
    }

    const nextText = reply.text;
    onChangeMessage(messageText ? `${messageText} ${nextText}` : nextText);
    setShowQuickReplies(false);
  }

  async function handleSendQuickReplyClick(reply: QuickReply) {
    setShowQuickReplies(false);
    setShowAttachmentMenu(false);
    setComposerError("");
    setExpandedQuickReplyMessageId(null);
    setExpandedEmojiMessageId(null);

    if (reply.attachment) {
      const file = await storedAttachmentToFile(reply.attachment);
      await onSendAttachment(file, reply.text);
      return;
    }

    await onSendQuickReply(reply.text);
  }

  function handleToggleInlineQuickReplies(messageId: string) {
    setExpandedEmojiMessageId(null);
    setExpandedQuickReplyMessageId((current) => (current === messageId ? null : messageId));
  }

  function handleToggleInlineEmojis(messageId: string) {
    setExpandedQuickReplyMessageId(null);
    setExpandedEmojiMessageId((current) => (current === messageId ? null : messageId));
  }

  function appendEmojiToComposer(emoji: string) {
    const nextValue = messageText && !/\s$/.test(messageText) ? `${messageText} ${emoji}` : `${messageText}${emoji}`;
    onChangeMessage(nextValue);
  }

  function handlePickComposerEmoji(emoji: string) {
    appendEmojiToComposer(emoji);
    setShowEmojiPicker(false);
  }

  function handleSendInlineEmoji(emoji: string) {
    setExpandedEmojiMessageId(null);
    setExpandedQuickReplyMessageId(null);
    void onSendQuickReply(emoji);
  }

  function handleDeleteQuickReply(replyId: string) {
    setQuickReplies((current) => current.filter((item) => item.id !== replyId));
  }

  async function handleQuickReplyAttachmentSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    if (!file) {
      return;
    }

    try {
      setQuickReplyDraftError("");
      setNewQuickReplyAttachment(await buildStoredQuickReplyAttachment(file));
    } catch (error) {
      setQuickReplyDraftError(error instanceof Error ? error.message : "Failed to attach file.");
    } finally {
      event.target.value = "";
    }
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

  function handleOpenAttachmentMenu() {
    setShowAttachmentMenu(true);
    setShowQuickReplies(false);
    setShowEmojiPicker(false);
    setComposerError("");
  }

  if (!phone) {
    return (
      <section className="glass-panel flex min-h-[320px] items-center justify-center border border-white/70 bg-white/58 p-6 sm:min-h-[420px]">
        <div className="max-w-sm text-center">
          <p className="text-sm uppercase tracking-[0.25em] text-emerald-800/65">No active chat</p>
          <h3 className="mt-3 text-2xl font-semibold text-ink">Pick a conversation</h3>
          <p className="mt-3 text-sm text-emerald-950/62">
            Select a contact from the left panel to review history and send a reply.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="glass-panel flex min-h-[120px] flex-col overflow-visible border border-white/70 bg-white/58 p-3 sm:min-h-[520px] sm:p-4 xl:max-h-[calc(100dvh-210px)]">
      <div className="mb-3 rounded-[26px] border border-white/60 bg-white/72 px-3 py-2 shadow-soft sm:px-4 sm:py-3">
        <div className="flex items-start justify-between gap-2 sm:gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-800/65">Active conversation</p>
            <h3 className="mt-0.5 truncate pr-2 text-sm font-semibold text-ink sm:text-lg">{title}</h3>
            <p className="mt-0.5 truncate pr-2 text-[11px] text-emerald-900/45 sm:text-sm">{formatPhoneDisplay(phone, chatJid)}</p>
            {showCustomerProfile && customerPanelProps ? (
              <button
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-900/58 transition hover:text-emerald-950 sm:text-xs"
                onClick={() => setShowCustomerProfile(false)}
                type="button"
              >
                <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
                  <path
                    d="m6 15 6-6 6 6"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
                Collapse details
              </button>
            ) : null}
          </div>

          {customerPanelProps ? (
            <button
              aria-label={showCustomerProfile ? "Hide customer profile" : "Show customer profile"}
              className="group flex shrink-0 items-center gap-2 self-start rounded-[22px] bg-emerald-50/80 px-1.5 py-1.5 shadow-soft transition hover:bg-white sm:px-2 sm:py-1.5"
              onClick={() => setShowCustomerProfile((current) => !current)}
              type="button"
            >
              {profilePictureUrl ? (
                <img
                  alt={title}
                  className="h-10 w-10 rounded-2xl object-cover shadow-soft sm:h-14 sm:w-14"
                  src={profilePictureUrl}
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-[10px] font-semibold text-white shadow-soft sm:h-14 sm:w-14 sm:text-sm">
                  {avatarLabel}
                </div>
              )}
              <div className="hidden min-w-0 text-left md:block">
                <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-800/55">Profile</p>
                <p className="truncate text-xs font-medium text-emerald-950/72 group-hover:text-emerald-950">
                  {showCustomerProfile ? "Hide customer" : "View customer"}
                </p>
              </div>
            </button>
          ) : null}
        </div>
      </div>

      {showCustomerProfile && customerPanelProps ? (
        <div className="mb-3">
          <CustomerPanel
            {...customerPanelProps}
            mobileCollapsed={false}
            onClose={() => setShowCustomerProfile(false)}
            variant="inline"
          />
        </div>
      ) : null}

      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-[28px] border border-emerald-100/80 bg-[rgba(233,246,238,0.92)] p-2 sm:space-y-3 sm:p-4"
        onScroll={updateStickToBottom}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-emerald-950/55">Loading messages...</div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-emerald-950/55">
            No messages in this conversation yet.
          </div>
        ) : (
          <>
            {hiddenMessageCount > 0 ? (
              <div className="flex justify-center pb-1">
                <button
                  className="border border-emerald-200/80 bg-white/92 px-3 py-1 text-[11px] font-medium text-emerald-900/70 transition hover:bg-white hover:text-emerald-950"
                  onClick={() => setShowAllMessages((current) => !current)}
                  type="button"
                >
                  {showAllMessages ? "Show latest 6 messages" : `View ${hiddenMessageCount} earlier messages`}
                </button>
              </div>
            ) : null}

            {visibleMessages.map((item) => (
              <div
                key={item.id}
                className={`flex flex-col ${item.direction === "outgoing" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[92%] overflow-hidden px-3 py-2 shadow-soft sm:max-w-[80%] sm:px-4 sm:py-3 ${
                    item.direction === "outgoing"
                      ? "chat-bubble-outgoing bg-gradient-to-br from-emerald-700 via-emerald-600 to-green-500 text-white"
                      : "chat-bubble-incoming border border-emerald-200/90 bg-white text-emerald-950/88"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words text-[13px] leading-5 sm:text-sm sm:leading-6">{item.message}</p>
                  <p
                    className={`mt-1.5 text-right text-[10px] sm:mt-2 sm:text-[11px] ${
                      item.direction === "outgoing" ? "text-white/78" : "text-emerald-900/46"
                    }`}
                  >
                    {item.direction === "outgoing"
                      ? `${formatTime(item.created_at)} | ${formatStatus(item)}`
                      : formatTime(item.created_at)}
                  </p>
                </div>

                {item.direction === "incoming" && quickReplies.length > 0 ? (
                  <div className="mt-2 flex max-w-[92%] items-center gap-2 overflow-hidden sm:max-w-[80%]">
                    <button
                      aria-label={expandedQuickReplyMessageId === item.id ? "Hide quick replies" : "Show quick replies"}
                      className="icon-hover-trigger flex h-7 w-7 shrink-0 appearance-none items-center justify-center border-0 bg-transparent p-0 text-emerald-900/62 transition hover:text-emerald-950 disabled:cursor-not-allowed disabled:opacity-55"
                      disabled={sending}
                      onClick={() => handleToggleInlineQuickReplies(item.id)}
                      type="button"
                    >
                      <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                        <path
                          d="M7 10h10M7 14h6m-7 7 3.6-3H18a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H6A3 3 0 0 0 3 7v8a3 3 0 0 0 3 3v3Z"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.8"
                        />
                      </svg>
                      <span className="icon-hover-label">
                        Quick replies
                      </span>
                    </button>

                    <button
                      aria-label={expandedEmojiMessageId === item.id ? "Hide emoji replies" : "Show emoji replies"}
                      className="icon-hover-trigger flex h-7 w-7 shrink-0 appearance-none items-center justify-center border-0 bg-transparent p-0 text-emerald-900/62 transition hover:text-emerald-950 disabled:cursor-not-allowed disabled:opacity-55"
                      disabled={sending}
                      onClick={() => handleToggleInlineEmojis(item.id)}
                      type="button"
                    >
                      <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M9 10h.01M15 10h.01" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                        <path d="M8.5 14c.8 1.3 2.05 2 3.5 2s2.7-.7 3.5-2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                      </svg>
                      <span className="icon-hover-label">
                        Emojis
                      </span>
                    </button>

                    <button
                      aria-label="Open attachments"
                      className="icon-hover-trigger flex h-7 w-7 shrink-0 appearance-none items-center justify-center border-0 bg-transparent p-0 text-emerald-900/62 transition hover:text-emerald-950 disabled:cursor-not-allowed disabled:opacity-55"
                      disabled={sending}
                      onClick={handleOpenAttachmentMenu}
                      type="button"
                    >
                      <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                        <path
                          d="m21.4 11.1-8.5 8.5a5 5 0 0 1-7.1-7.1l9.2-9.2a3.5 3.5 0 0 1 5 5L10.5 17.8a2 2 0 1 1-2.8-2.8l8-8"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.8"
                        />
                      </svg>
                      <span className="icon-hover-label">
                        Attachments
                      </span>
                    </button>

                    {expandedQuickReplyMessageId === item.id ? (
                      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
                        {quickReplies.map((reply) => (
                          <button
                            key={`${item.id}-${reply.id}`}
                            className="quick-reply-chip shrink-0 border border-emerald-200/90 bg-white/92 px-3 py-1.5 text-[11px] font-medium text-emerald-900/78 transition hover:bg-white hover:text-emerald-950 disabled:cursor-not-allowed disabled:opacity-55 sm:text-xs"
                            disabled={sending}
                            onClick={() => void handleSendQuickReplyClick(reply)}
                            type="button"
                          >
                            {reply.attachment ? `📎 ${getQuickReplyLabel(reply)}` : getQuickReplyLabel(reply)}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {expandedEmojiMessageId === item.id ? (
                      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
                        {commonEmojis.map((emoji) => (
                          <button
                            key={`${item.id}-${emoji}`}
                            className="icon-hover-trigger quick-reply-chip shrink-0 border border-emerald-200/90 bg-white/92 px-3 py-1.5 text-base leading-none text-emerald-900/88 transition hover:bg-white hover:text-emerald-950 disabled:cursor-not-allowed disabled:opacity-55"
                            disabled={sending}
                            onClick={() => handleSendInlineEmoji(emoji)}
                            type="button"
                          >
                            {emoji}
                            <span className="icon-hover-label">{`Send ${emoji}`}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="relative z-10 mt-3 space-y-2">
        {showQuickReplies ? (
          <div className="rounded-[26px] border border-white/60 bg-white/72 p-3 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink">Quick replies</p>
              <button
                className="text-xs font-medium text-emerald-900/45 transition hover:text-emerald-900/75"
                onClick={() => setShowQuickReplies(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <div className="mt-3 max-h-36 overflow-y-auto pr-1">
              <div className="flex flex-wrap gap-2">
              {quickReplies.map((reply) => (
                <div key={reply.id} className="flex items-center gap-1 rounded-full bg-emerald-50 pr-1 shadow-soft">
                  <button
                    className="rounded-full px-3 py-2 text-left text-sm text-emerald-950/74 transition hover:bg-white"
                    onClick={() => void handlePickQuickReply(reply)}
                    type="button"
                  >
                    {reply.attachment ? `📎 ${getQuickReplyContentLabel(reply)}` : getQuickReplyContentLabel(reply)}
                  </button>
                  <button
                    aria-label={`Delete quick reply: ${getQuickReplyContentLabel(reply)}`}
                    className="icon-hover-trigger flex h-8 w-8 items-center justify-center rounded-full text-emerald-900/38 transition hover:bg-white hover:text-rose-500"
                    onClick={() => handleDeleteQuickReply(reply.id)}
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
                    <span className="icon-hover-label">Delete</span>
                  </button>
                </div>
              ))}
              </div>
            </div>
            <input
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
              aria-label="Choose quick reply attachment"
              className="hidden"
              onChange={(event) => void handleQuickReplyAttachmentSelection(event)}
              ref={quickReplyAttachmentInputRef}
              type="file"
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                className="icon-hover-trigger flex h-10 w-10 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-emerald-900/72 transition hover:text-emerald-950"
                onClick={() => setShowQuickReplyEmojiPicker((current) => !current)}
                type="button"
              >
                <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M9 10h.01M15 10h.01" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                  <path d="M8.5 14c.8 1.3 2.05 2 3.5 2s2.7-.7 3.5-2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                </svg>
                <span className="icon-hover-label">
                  Add emoji
                </span>
              </button>
              <button
                className="icon-hover-trigger flex h-10 w-10 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-emerald-900/72 transition hover:text-emerald-950"
                onClick={() => quickReplyAttachmentInputRef.current?.click()}
                type="button"
              >
                <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
                  <path
                    d="m21.4 11.1-8.5 8.5a5 5 0 0 1-7.1-7.1l9.2-9.2a3.5 3.5 0 0 1 5 5L10.5 17.8a2 2 0 1 1-2.8-2.8l8-8"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                </svg>
                <span className="icon-hover-label">
                  Add attachment
                </span>
              </button>

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
            {showQuickReplyEmojiPicker ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {commonEmojis.map((emoji) => (
                  <button
                    key={`quick-reply-draft-${emoji}`}
                    className="quick-reply-chip border border-emerald-200/90 bg-white/92 px-3 py-2 text-xl leading-none transition hover:bg-white"
                    onClick={() => setNewQuickReply((current) => `${current}${emoji}`)}
                    type="button"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
            {newQuickReplyAttachment ? (
              <div className="mt-3 flex items-center justify-between gap-2 rounded-[18px] bg-emerald-50/75 px-3 py-2 text-sm text-emerald-950/72">
                <span className="truncate">Attached: {newQuickReplyAttachment.name}</span>
                <button
                  className="text-xs font-medium text-emerald-900/55 transition hover:text-emerald-950"
                  onClick={() => setNewQuickReplyAttachment(null)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            ) : null}
            {quickReplyDraftError ? <p className="mt-3 text-sm text-rose-500">{quickReplyDraftError}</p> : null}
          </div>
        ) : null}

        {showAttachmentMenu ? (
          <div className="rounded-[26px] border border-white/60 bg-white/72 p-3 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink">Attachments</p>
              <button
                className="text-xs font-medium text-emerald-900/45 transition hover:text-emerald-900/75"
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
                      ? "bg-gradient-to-r from-emerald-500 to-green-400 text-white shadow-soft"
                      : "bg-white/82 text-emerald-900/60 hover:bg-white"
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
                  aria-label={attachmentTab === "image" ? "Choose picture attachment" : "Choose document attachment"}
                  className="hidden"
                  onChange={handleFileSelection}
                  ref={attachmentTab === "image" ? imageInputRef : documentInputRef}
                  type="file"
                />
                <div className="rounded-[22px] bg-emerald-50/75 p-3 text-sm text-emerald-950/62">
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

        {showEmojiPicker ? (
          <div className="rounded-[26px] border border-white/60 bg-white/72 p-3 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink">Emojis</p>
              <button
                className="text-xs font-medium text-emerald-900/45 transition hover:text-emerald-900/75"
                onClick={() => setShowEmojiPicker(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {commonEmojis.map((emoji) => (
                <button
                  key={emoji}
                  className="icon-hover-trigger quick-reply-chip border border-emerald-200/90 bg-white/92 px-3 py-2 text-xl leading-none transition hover:bg-white"
                  onClick={() => handlePickComposerEmoji(emoji)}
                  type="button"
                >
                  {emoji}
                  <span className="icon-hover-label">{`Insert ${emoji}`}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="rounded-[26px] border border-white/60 bg-white/72 p-2 shadow-soft">
          <div className="flex items-center gap-2">
          <button
            className={`icon-hover-trigger flex h-10 w-10 shrink-0 appearance-none items-center justify-center border-0 bg-transparent p-0 text-emerald-900/72 shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-emerald-950 focus:bg-transparent sm:h-11 sm:w-11 ${
              showQuickReplies ? "text-emerald-950" : ""
            }`}
            onClick={() => {
              setShowQuickReplies((current) => !current);
              setShowAttachmentMenu(false);
              setShowEmojiPicker(false);
              setComposerError("");
            }}
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
            <span className="icon-hover-label">Quick replies</span>
          </button>

          <button
            className={`icon-hover-trigger flex h-10 w-10 shrink-0 appearance-none items-center justify-center border-0 bg-transparent p-0 text-emerald-900/72 shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-emerald-950 focus:bg-transparent sm:h-11 sm:w-11 ${
              showAttachmentMenu ? "text-emerald-950" : ""
            }`}
            onClick={() => {
              setShowAttachmentMenu((current) => !current);
              setShowQuickReplies(false);
              setShowEmojiPicker(false);
              setComposerError("");
            }}
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
            <span className="icon-hover-label">Attachments</span>
          </button>

          <button
            className={`icon-hover-trigger flex h-10 w-10 shrink-0 appearance-none items-center justify-center border-0 bg-transparent p-0 text-emerald-900/72 shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-emerald-950 focus:bg-transparent sm:h-11 sm:w-11 ${
              showEmojiPicker ? "text-emerald-950" : ""
            }`}
            onClick={() => {
              setShowEmojiPicker((current) => !current);
              setShowAttachmentMenu(false);
              setShowQuickReplies(false);
              setComposerError("");
            }}
            type="button"
          >
            <ActionIcon>
              <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
                <path d="M9 10h.01M15 10h.01" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                <path d="M8.5 14c.8 1.3 2.05 2 3.5 2s2.7-.7 3.5-2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
              </svg>
            </ActionIcon>
            <span className="icon-hover-label">
              Emojis
            </span>
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
