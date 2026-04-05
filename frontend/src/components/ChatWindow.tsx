import { useEffect, useRef, useState, type ChangeEvent, type ComponentProps, type ReactNode } from "react";
import { CUSTOMER_STATUSES, CUSTOMER_STATUS_LABELS, type CustomerStatus, type Message, type SalesLeadItem } from "../lib/api";
import { CustomerPanel } from "./CustomerPanel";
import { getDisplayName, getDisplayPhone, formatPhoneDisplay } from "../lib/display";

type ChatWindowProps = {
  contactName: string | null;
  phone: string | null;
  chatJid?: string | null;
  profilePictureUrl?: string | null;
  messages: Message[];
  deletingMessageId?: string | null;
  salesLeadItems?: SalesLeadItem[];
  salesLeadStatus?: CustomerStatus;
  loadingSalesLeadItems?: boolean;
  savingSalesLeadItem?: boolean;
  messageText: string;
  loading: boolean;
  sending: boolean;
  customerPanelProps?: ComponentProps<typeof CustomerPanel> | null;
  onChangeMessage: (value: string) => void;
  onCreateSalesLeadItem?: (payload: {
    messageId: string;
    status: CustomerStatus;
    productType: string;
    packageName: string;
    price: number;
    quantity: number;
  }) => Promise<void> | void;
  onDeleteMessage?: (message: Message) => Promise<void> | void;
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

type MediaLightbox = {
  src: string;
  alt: string;
  downloadName: string;
};

const quickRepliesStorageKey = "whatsapp-crm.quick-replies";
const defaultQuickReplies: QuickReply[] = [
  { id: "default-thanks", text: "Thanks for reaching out. I will get back to you shortly." },
  { id: "default-budget", text: "Can you share your preferred package or budget?" },
  { id: "default-update", text: "I have noted your request and will update you soon." }
];
const commonEmojis = ["\u{1F600}", "\u{1F602}", "\u{1F60D}", "\u{1F64F}", "\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F389}", "\u{1F604}"];

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatSalesLeadTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "MYR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function getLeadStatusBadgeClasses(status: CustomerStatus) {
  switch (status) {
    case "new_lead":
      return "border-yellow-200 bg-yellow-50 text-yellow-700";
    case "interested":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "processing":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "closed_won":
      return "border-slate-300 bg-slate-100 text-slate-800";
    case "closed_lost":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-whatsapp-line bg-whatsapp-canvas text-whatsapp-deep";
  }
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

function isImageMessage(message: Message) {
  return message.media_type === "image" && Boolean(message.media_data_url);
}

function isVideoMessage(message: Message) {
  return message.media_type === "video" && Boolean(message.media_data_url);
}

function isDocumentMessage(message: Message) {
  return message.media_type === "document" && Boolean(message.media_data_url);
}

function getSyntheticMediaPlaceholder(message: Message) {
  if (isImageMessage(message)) {
    return "[Image]";
  }

  if (isVideoMessage(message)) {
    return "[Video]";
  }

  if (isDocumentMessage(message)) {
    return message.media_file_name ? `[Document] ${message.media_file_name}` : "[Document]";
  }

  return null;
}

function stripMediaPreviewPrefix(message: Message) {
  const rawText = message.message.trim();

  if (isImageMessage(message)) {
    const fileName = message.media_file_name?.trim();
    if (rawText === "[Image]") {
      return "";
    }
    if (fileName && rawText === `[Image] ${fileName}`) {
      return "";
    }
    if (fileName && rawText.startsWith(`[Image] ${fileName} - `)) {
      return rawText.slice(`[Image] ${fileName} - `.length).trim();
    }
  }

  if (isVideoMessage(message)) {
    const fileName = message.media_file_name?.trim();
    if (rawText === "[Video]") {
      return "";
    }
    if (fileName && rawText === `[Video] ${fileName}`) {
      return "";
    }
    if (fileName && rawText.startsWith(`[Video] ${fileName} - `)) {
      return rawText.slice(`[Video] ${fileName} - `.length).trim();
    }
  }

  if (isDocumentMessage(message)) {
    const fileName = message.media_file_name?.trim();
    if (rawText === "[Document]") {
      return "";
    }
    if (fileName && rawText === `[Document] ${fileName}`) {
      return "";
    }
    if (fileName && rawText.startsWith(`[Document] ${fileName} - `)) {
      return rawText.slice(`[Document] ${fileName} - `.length).trim();
    }
  }

  return rawText;
}

function getRenderableMessageText(message: Message) {
  const syntheticPlaceholder = getSyntheticMediaPlaceholder(message);
  if (syntheticPlaceholder && message.message.trim() === syntheticPlaceholder) {
    return "";
  }

  return stripMediaPreviewPrefix(message);
}

function ActionIcon(props: { children: ReactNode }) {
  return <span className="flex h-4 w-4 items-center justify-center">{props.children}</span>;
}

async function requestElementFullscreen(element: HTMLElement | null) {
  if (!element) {
    return;
  }

  if (document.fullscreenElement === element) {
    return;
  }

  if (typeof element.requestFullscreen === "function") {
    await element.requestFullscreen();
  }
}

function openMediaInNewTab(src: string | null | undefined) {
  if (!src) {
    return;
  }

  window.open(src, "_blank", "noopener,noreferrer");
}

function getMediaDownloadName(message: Message, fallbackName: string) {
  const fileName = message.media_file_name?.trim();
  if (fileName) {
    return fileName;
  }

  const mimeType = message.media_mime_type?.trim() || "";
  const extension = mimeType.startsWith("image/") ? mimeType.slice("image/".length) : "bin";
  return `${fallbackName}.${extension || "bin"}`;
}

function IncomingDocumentCard(props: { message: Message }) {
  const fileName = props.message.media_file_name || "Document";
  const mimeType = props.message.media_mime_type || "File";

  return (
    <a
      className="mb-2 flex items-center gap-3 rounded-[18px] border border-whatsapp-line bg-whatsapp-canvas p-3 text-left transition hover:bg-white"
      download={fileName}
      href={props.message.media_data_url || undefined}
      rel="noreferrer"
      target="_blank"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-white text-whatsapp-dark shadow-soft">
        <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
          <path d="M14 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7l-4-4Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
          <path d="M14 3v4h4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
          <path d="M12 11v6m0 0 2.5-2.5M12 17l-2.5-2.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{fileName}</p>
        <p className="truncate text-xs text-whatsapp-muted">{mimeType}</p>
      </div>
    </a>
  );
}

function IncomingVideoCard(props: { message: Message }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  return (
    <div className="mb-2 overflow-hidden rounded-[18px] border border-whatsapp-line bg-whatsapp-canvas">
      <video
        ref={videoRef}
        className="block max-h-[320px] w-full bg-black object-contain"
        controls
        preload="metadata"
        src={props.message.media_data_url || undefined}
      />
      <div className="flex items-center justify-end gap-2 border-t border-whatsapp-line bg-white px-3 py-2">
        <button
          className="text-xs font-medium text-whatsapp-muted transition hover:text-whatsapp-deep"
          onClick={() => void requestElementFullscreen(videoRef.current)}
          type="button"
        >
          Full screen
        </button>
        <button
          className="text-xs font-medium text-whatsapp-muted transition hover:text-whatsapp-deep"
          onClick={() => openMediaInNewTab(props.message.media_data_url)}
          type="button"
        >
          Open in new tab
        </button>
      </div>
    </div>
  );
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
    deletingMessageId = null,
    salesLeadItems = [],
    salesLeadStatus,
    loadingSalesLeadItems = false,
    savingSalesLeadItem = false,
    messageText,
    loading,
    sending,
    customerPanelProps,
    onChangeMessage,
    onCreateSalesLeadItem,
    onDeleteMessage,
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
  const [resolvingLocation, setResolvingLocation] = useState(false);
  const [composerError, setComposerError] = useState("");
  const [showCustomerProfile, setShowCustomerProfile] = useState(false);
  const [expandedLeadRegistrationMessageId, setExpandedLeadRegistrationMessageId] = useState<string | null>(null);
  const [leadProductType, setLeadProductType] = useState("");
  const [leadPackageName, setLeadPackageName] = useState("");
  const [leadPrice, setLeadPrice] = useState("");
  const [leadQuantity, setLeadQuantity] = useState("1");
  const [leadStatus, setLeadStatus] = useState<CustomerStatus>(salesLeadStatus || "new_lead");
  const [leadFormError, setLeadFormError] = useState("");
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [expandedQuickReplyMessageId, setExpandedQuickReplyMessageId] = useState<string | null>(null);
  const [expandedEmojiMessageId, setExpandedEmojiMessageId] = useState<string | null>(null);
  const [expandedAttachmentMessageId, setExpandedAttachmentMessageId] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [mediaLightbox, setMediaLightbox] = useState<MediaLightbox | null>(null);

  const displayPhone = getDisplayPhone(phone, chatJid);
  const title = getDisplayName(contactName, displayPhone);
  const avatarLabel = title.slice(0, 2).toUpperCase();
  const visibleMessages = showAllMessages ? messages : messages.slice(-6);
  const hiddenMessageCount = Math.max(messages.length - 6, 0);
  const canRegisterLead = Boolean(phone && onCreateSalesLeadItem);

  async function handleCreateSalesLead() {
    if (!onCreateSalesLeadItem || !expandedLeadRegistrationMessageId) {
      return;
    }

    const productType = leadProductType.trim();
    const packageName = leadPackageName.trim();
    const price = Number(leadPrice);
    const quantity = Number(leadQuantity);
    const status = leadStatus;

    if (!productType || !packageName) {
      setLeadFormError("Product type and package are required.");
      return;
    }

    if (!Number.isFinite(price) || price < 0) {
      setLeadFormError("Price must be a valid non-negative number.");
      return;
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setLeadFormError("Quantity must be a whole number greater than 0.");
      return;
    }

    setLeadFormError("");

    try {
      await onCreateSalesLeadItem({
        messageId: expandedLeadRegistrationMessageId,
        status,
        productType,
        packageName,
        price,
        quantity
      });

      setLeadProductType("");
      setLeadPackageName("");
      setLeadPrice("");
      setLeadQuantity("1");
      setLeadStatus(status);
    } catch (error) {
      setLeadFormError(error instanceof Error ? error.message : "Failed to save sales lead details.");
    }
  }

  useEffect(() => {
    setLeadStatus(salesLeadStatus || "new_lead");
  }, [salesLeadStatus]);

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
    if (!mediaLightbox) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMediaLightbox(null);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mediaLightbox]);

  useEffect(() => {
    const locationPanelVisible = showAttachmentMenu || Boolean(expandedAttachmentMessageId);
    const hasCoordinates = Boolean(latitude.trim() && longitude.trim());

    if (attachmentTab !== "location" || !locationPanelVisible || hasCoordinates || resolvingLocation) {
      return;
    }

    void handleSendCurrentLocation();
  }, [attachmentTab, expandedAttachmentMessageId, latitude, longitude, resolvingLocation, showAttachmentMenu]);

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
      setExpandedLeadRegistrationMessageId(null);
      setLeadProductType("");
      setLeadPackageName("");
      setLeadPrice("");
      setLeadQuantity("1");
      setLeadStatus(salesLeadStatus || "new_lead");
      setLeadFormError("");
      setShowAllMessages(false);
      setExpandedQuickReplyMessageId(null);
      setExpandedEmojiMessageId(null);
      setExpandedAttachmentMessageId(null);
      setShowEmojiPicker(false);
      setMediaLightbox(null);
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
    setExpandedAttachmentMessageId(null);

    if (reply.attachment) {
      const file = await storedAttachmentToFile(reply.attachment);
      await onSendAttachment(file, reply.text);
      return;
    }

    await onSendQuickReply(reply.text);
  }

  function handleToggleInlineQuickReplies(messageId: string) {
    setExpandedEmojiMessageId(null);
    setExpandedAttachmentMessageId(null);
    setExpandedQuickReplyMessageId((current) => (current === messageId ? null : messageId));
  }

  function handleToggleInlineEmojis(messageId: string) {
    setExpandedQuickReplyMessageId(null);
    setExpandedAttachmentMessageId(null);
    setExpandedEmojiMessageId((current) => (current === messageId ? null : messageId));
  }

  function handleToggleInlineAttachments(messageId: string) {
    setShowAttachmentMenu(false);
    setExpandedQuickReplyMessageId(null);
    setExpandedEmojiMessageId(null);
    setExpandedAttachmentMessageId((current) => (current === messageId ? null : messageId));
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
    setExpandedAttachmentMessageId(null);
    void onSendQuickReply(emoji);
  }

  function handleDeleteQuickReply(replyId: string) {
    setQuickReplies((current) => current.filter((item) => item.id !== replyId));
  }

  function handleDeleteMessageClick(message: Message) {
    if (!onDeleteMessage) {
      return;
    }

    const confirmed = window.confirm("Delete this message from the CRM? WhatsApp will also be updated when possible.");

    if (!confirmed) {
      return;
    }

    setExpandedQuickReplyMessageId((current) => (current === message.id ? null : current));
    setExpandedEmojiMessageId((current) => (current === message.id ? null : current));
    setExpandedAttachmentMessageId((current) => (current === message.id ? null : current));
    setExpandedLeadRegistrationMessageId((current) => (current === message.id ? null : current));
    setLeadFormError("");
    setComposerError("");
    void onDeleteMessage(message);
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
      setExpandedAttachmentMessageId(null);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Failed to send attachment.");
    }
  }

  async function handleSendCurrentLocation() {
    if (!navigator.geolocation) {
      setComposerError("Geolocation is not supported on this device.");
      return;
    }

    setResolvingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setComposerError("");
        setResolvingLocation(false);
      },
      () => {
        setComposerError("Unable to get your current location.");
        setResolvingLocation(false);
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
      setExpandedAttachmentMessageId(null);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Failed to send location.");
    }
  }

  function handleOpenAttachmentMenu() {
    setShowAttachmentMenu(true);
    setShowQuickReplies(false);
    setShowEmojiPicker(false);
    setExpandedAttachmentMessageId(null);
    setComposerError("");
  }

  const attachmentPanelContent = (
    <>
      <div className="flex flex-wrap gap-2">
        {([
          { key: "image", label: "Picture" },
          { key: "document", label: "Document" },
          { key: "location", label: "Location" }
        ] as const).map((item) => (
          <button
            key={item.key}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              attachmentTab === item.key
                ? "bg-whatsapp-dark text-white shadow-soft"
                : "border border-whatsapp-line bg-white text-whatsapp-muted hover:bg-whatsapp-soft"
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
          <div className="rounded-[22px] border border-whatsapp-line bg-whatsapp-canvas p-3 text-sm text-whatsapp-muted">
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
            <button className="secondary-button" disabled={resolvingLocation} onClick={handleSendCurrentLocation} type="button">
              {resolvingLocation ? "Getting location..." : "Use current location"}
            </button>
            <button className="primary-button" disabled={sending} onClick={handleSendLocationClick} type="button">
              {sending ? "Sending..." : "Send location"}
            </button>
          </div>
        </div>
      )}

      {composerError ? <p className="mt-3 text-sm text-rose-500">{composerError}</p> : null}
    </>
  );

  if (!phone) {
    return (
      <section className="glass-panel flex min-h-[320px] items-center justify-center p-6 sm:min-h-[420px]">
        <div className="max-w-sm text-center">
          <p className="text-sm uppercase tracking-[0.25em] text-whatsapp-muted">No active chat</p>
          <h3 className="mt-3 text-2xl font-semibold text-ink">Pick a conversation</h3>
          <p className="mt-3 text-sm text-whatsapp-muted">
            Select a contact from the left panel to review history and send a reply.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="glass-panel relative flex min-h-[120px] flex-col overflow-visible p-2 sm:min-h-[520px] sm:p-3 xl:max-h-[calc(100dvh-210px)]">
      <div className="mb-2 rounded-xl border border-whatsapp-line bg-white px-3 py-2 shadow-soft sm:px-4 sm:py-3">
        <div className="flex items-start justify-between gap-2 sm:gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.2em] text-whatsapp-muted">Active conversation</p>
            <h3 className="mt-0.5 truncate pr-2 text-sm font-semibold text-ink sm:text-lg">{title}</h3>
            <p className="mt-0.5 truncate pr-2 text-[11px] text-whatsapp-muted sm:text-sm">{formatPhoneDisplay(phone, chatJid)}</p>
            {showCustomerProfile && customerPanelProps ? (
              <button
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-whatsapp-muted transition hover:text-whatsapp-deep sm:text-xs"
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

          {(customerPanelProps || canRegisterLead) ? (
            <div className="flex shrink-0 flex-col items-end gap-2 self-start">
              {customerPanelProps ? (
                <button
                  aria-label={showCustomerProfile ? "Hide customer profile" : "Show customer profile"}
                  className="icon-hover-trigger group flex items-center gap-2 rounded-lg border border-whatsapp-line bg-[#f8f5f2] px-1.5 py-1.5 shadow-soft transition hover:bg-white sm:px-2 sm:py-1.5"
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
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-whatsapp-dark text-[10px] font-semibold text-white shadow-soft sm:h-14 sm:w-14 sm:text-sm">
                      {avatarLabel}
                    </div>
                  )}
                  <div className="hidden min-w-0 text-left md:block">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-whatsapp-muted">Profile</p>
                    <p className="truncate text-xs font-medium text-ink/80 group-hover:text-whatsapp-deep">
                      {showCustomerProfile ? "Hide customer" : "View customer"}
                    </p>
                  </div>
                  <span className="icon-hover-label">{showCustomerProfile ? "Hide customer" : "View customer"}</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {showCustomerProfile && customerPanelProps ? (
        <div className="pointer-events-none absolute inset-0 z-20 p-2 sm:p-3">
          <div className="pointer-events-auto h-full overflow-hidden rounded-2xl border border-whatsapp-line/80 bg-white/90 shadow-[0_24px_60px_rgba(16,33,29,0.18)] backdrop-blur-sm">
            <CustomerPanel
              {...customerPanelProps}
              mobileCollapsed={false}
              onClose={() => setShowCustomerProfile(false)}
              variant="inline"
            />
          </div>
        </div>
      ) : null}

      <div
        ref={listRef}
        className="custom-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl border border-whatsapp-line bg-whatsapp-canvas p-2 sm:space-y-3 sm:p-3"
        onScroll={updateStickToBottom}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-whatsapp-muted">Loading messages...</div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-whatsapp-muted">
            No messages in this conversation yet.
          </div>
        ) : (
          <>
            {hiddenMessageCount > 0 ? (
              <div className="flex justify-center pb-1">
                <button
                  className="border border-whatsapp-line bg-white px-3 py-1 text-[11px] font-medium text-whatsapp-muted transition hover:bg-whatsapp-soft hover:text-whatsapp-deep"
                  onClick={() => setShowAllMessages((current) => !current)}
                  type="button"
                >
                  {showAllMessages ? "Show latest 6 messages" : `View ${hiddenMessageCount} earlier messages`}
                </button>
              </div>
            ) : null}

            {visibleMessages.map((item) => {
              const renderableText = getRenderableMessageText(item);
              const canDeleteMessage = Boolean(onDeleteMessage) && !item.id.startsWith("temp-");
              const isDeletingMessage = deletingMessageId === item.id;
              const showIncomingActions = item.direction === "incoming" && quickReplies.length > 0;
              const linkedSalesLeadItems = salesLeadItems.filter((salesItem) => salesItem.message_id === item.id);
              const hasLinkedSalesLead = linkedSalesLeadItems.length > 0;
              const linkedLeadStatus = salesLeadStatus || "new_lead";

              return (
              <div
                key={item.id}
                className={`flex flex-col ${item.direction === "outgoing" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[92%] overflow-hidden px-3 py-2 shadow-soft sm:max-w-[80%] sm:px-4 sm:py-3 ${
                    item.direction === "outgoing"
                      ? "chat-bubble-outgoing border border-[#cfe7bb] bg-whatsapp-soft text-ink/90"
                      : "chat-bubble-incoming border border-whatsapp-line bg-white text-ink/90"
                  }`}
                >
                  {hasLinkedSalesLead ? (
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${getLeadStatusBadgeClasses(linkedLeadStatus)}`}
                      >
                        <span className="h-2 w-2 rounded-full bg-current opacity-80" />
                        {CUSTOMER_STATUS_LABELS[linkedLeadStatus]}
                      </span>
                      <span className="text-[10px] font-medium text-whatsapp-muted">
                        {linkedSalesLeadItems.length} lead{linkedSalesLeadItems.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  ) : null}
                  {isImageMessage(item) ? (
                    <div className="mb-2 inline-flex max-w-[220px] flex-col overflow-hidden rounded-lg border border-whatsapp-line bg-[#f7f1ea]">
                      <button
                        aria-label="Open image preview"
                        className="icon-hover-trigger group relative block w-full text-left"
                        onClick={() =>
                          setMediaLightbox({
                            src: item.media_data_url || "",
                            alt: item.media_file_name || "Incoming image",
                            downloadName: getMediaDownloadName(item, "picture")
                          })
                        }
                        type="button"
                      >
                        <img
                          alt={item.media_file_name || "Incoming image"}
                          className="block h-auto max-h-[180px] w-full object-cover transition duration-200 group-hover:scale-[1.01]"
                          loading="lazy"
                          src={item.media_data_url || undefined}
                        />
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-3 py-2 text-xs font-medium text-white opacity-0 transition group-hover:opacity-100">
                          Click to enlarge
                        </span>
                        <span className="icon-hover-label">Open image preview</span>
                      </button>
                      <div className="flex items-center justify-end border-t border-whatsapp-line bg-white px-2 py-2">
                        <a
                          aria-label="Save picture"
                          className="icon-hover-trigger flex h-8 w-8 items-center justify-center rounded-full text-whatsapp-muted transition hover:bg-whatsapp-soft hover:text-whatsapp-deep"
                          download={getMediaDownloadName(item, "picture")}
                          href={item.media_data_url || undefined}
                        >
                          <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                            <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v1a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                          </svg>
                          <span className="icon-hover-label">Save picture</span>
                        </a>
                      </div>
                    </div>
                  ) : null}
                  {isVideoMessage(item) ? <IncomingVideoCard message={item} /> : null}
                  {isDocumentMessage(item) ? <IncomingDocumentCard message={item} /> : null}
                  {renderableText ? (
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-5 sm:text-sm sm:leading-6">{renderableText}</p>
                  ) : null}
                  <p
                    className={`mt-1.5 text-right text-[10px] sm:mt-2 sm:text-[11px] ${
                      item.direction === "outgoing" ? "text-ink/65" : "text-whatsapp-muted"
                    }`}
                  >
                    {item.direction === "outgoing"
                      ? `${formatTime(item.created_at)} | ${formatStatus(item)}`
                      : formatTime(item.created_at)}
                  </p>
                </div>

                {canDeleteMessage && !showIncomingActions ? (
                  <div className="mt-2 flex max-w-[92%] items-center gap-2 overflow-hidden sm:max-w-[80%]">
                    <button
                      aria-label={isDeletingMessage ? "Deleting message" : "Delete message"}
                      className="icon-hover-trigger flex h-7 w-7 shrink-0 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted transition hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-55"
                      disabled={isDeletingMessage}
                      onClick={() => handleDeleteMessageClick(item)}
                      type="button"
                    >
                      <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                        <path d="M4 7h16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                        <path d="M10 11v6M14 11v6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                        <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                        <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                      </svg>
                      <span className="icon-hover-label">{isDeletingMessage ? "Deleting..." : "Delete message"}</span>
                    </button>
                  </div>
                ) : null}

                {showIncomingActions ? (
                  <div className="mt-2 flex max-w-[92%] items-center gap-2 overflow-hidden sm:max-w-[80%]">
                    <button
                      aria-label={expandedQuickReplyMessageId === item.id ? "Hide quick replies" : "Show quick replies"}
                      className="icon-hover-trigger flex h-7 w-7 shrink-0 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted transition hover:text-whatsapp-deep disabled:cursor-not-allowed disabled:opacity-55"
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
                      className="icon-hover-trigger flex h-7 w-7 shrink-0 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted transition hover:text-whatsapp-deep disabled:cursor-not-allowed disabled:opacity-55"
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
                      className="icon-hover-trigger flex h-7 w-7 shrink-0 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted transition hover:text-whatsapp-deep disabled:cursor-not-allowed disabled:opacity-55"
                      disabled={sending}
                      onClick={() => handleToggleInlineAttachments(item.id)}
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

                    {canRegisterLead ? (
                      <button
                        aria-label={expandedLeadRegistrationMessageId === item.id ? "Hide sales lead registration" : "Show sales lead registration"}
                        className="icon-hover-trigger flex h-7 w-7 shrink-0 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted transition hover:text-whatsapp-deep disabled:cursor-not-allowed disabled:opacity-55"
                        disabled={sending}
                        onClick={() => {
                          setExpandedLeadRegistrationMessageId((current) => (current === item.id ? null : item.id));
                          setComposerError("");
                        }}
                        type="button"
                      >
                        <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                          <path d="M9 12h6M12 9v6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                          <path d="M7 4h7l3 3v13a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                          <path d="M14 4v4h4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                        </svg>
                        <span className="icon-hover-label">Lead Registering</span>
                      </button>
                    ) : null}

                    {canDeleteMessage ? (
                      <button
                        aria-label={isDeletingMessage ? "Deleting message" : "Delete message"}
                        className="icon-hover-trigger flex h-7 w-7 shrink-0 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted transition hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-55"
                        disabled={isDeletingMessage}
                        onClick={() => handleDeleteMessageClick(item)}
                        type="button"
                      >
                        <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                          <path d="M4 7h16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                          <path d="M10 11v6M14 11v6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                          <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                          <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                        </svg>
                        <span className="icon-hover-label">{isDeletingMessage ? "Deleting..." : "Delete message"}</span>
                      </button>
                    ) : null}

                    {expandedQuickReplyMessageId === item.id ? (
                      <div className="custom-scrollbar-x flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
                        {quickReplies.map((reply) => (
                          <button
                            key={`${item.id}-${reply.id}`}
                            className="quick-reply-chip shrink-0 border border-whatsapp-line bg-white px-3 py-1.5 text-[11px] font-medium text-whatsapp-muted transition hover:bg-whatsapp-soft hover:text-whatsapp-deep disabled:cursor-not-allowed disabled:opacity-55 sm:text-xs"
                            disabled={sending}
                            onClick={() => void handleSendQuickReplyClick(reply)}
                            type="button"
                          >
                            {reply.attachment ? `[Attachment] ${getQuickReplyLabel(reply)}` : getQuickReplyLabel(reply)}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {expandedEmojiMessageId === item.id ? (
                      <div className="custom-scrollbar-x flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
                        {commonEmojis.map((emoji) => (
                          <button
                            key={`${item.id}-${emoji}`}
                            className="icon-hover-trigger quick-reply-chip shrink-0 border border-whatsapp-line bg-white px-3 py-1.5 text-base leading-none text-whatsapp-deep transition hover:bg-whatsapp-soft disabled:cursor-not-allowed disabled:opacity-55"
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

                {item.direction === "incoming" && expandedAttachmentMessageId === item.id ? (
                  <div className="mt-2 w-full max-w-[92%] rounded-lg border border-whatsapp-line bg-white p-3 shadow-soft sm:max-w-[80%]">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-ink">Attachments</p>
                      <button
                        className="text-xs font-medium text-whatsapp-muted transition hover:text-whatsapp-deep"
                        onClick={() => setExpandedAttachmentMessageId(null)}
                        type="button"
                      >
                        Close
                      </button>
                    </div>
                    <div className="mt-3">{attachmentPanelContent}</div>
                  </div>
                ) : null}

                {item.direction === "incoming" && expandedLeadRegistrationMessageId === item.id && canRegisterLead ? (
                  <div className="mt-2 w-full max-w-[92%] rounded-lg border border-whatsapp-line bg-white p-3 shadow-soft sm:max-w-[80%] sm:p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.22em] text-whatsapp-muted">Lead Registering</p>
                        <h4 className="mt-1 text-sm font-semibold text-ink sm:text-base">Register sales products for this customer</h4>
                      </div>
                      {salesLeadStatus ? (
                        <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${getLeadStatusBadgeClasses(salesLeadStatus)}`}>
                          {CUSTOMER_STATUS_LABELS[salesLeadStatus]}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="block sm:col-span-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-whatsapp-muted">Lead status</span>
                        <select
                          className="input-glass mt-1"
                          onChange={(event) => setLeadStatus(event.target.value as CustomerStatus)}
                          value={leadStatus}
                        >
                          {CUSTOMER_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {CUSTOMER_STATUS_LABELS[status]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-whatsapp-muted">Product type</span>
                        <select
                          className="input-glass mt-1"
                          onChange={(event) => setLeadProductType(event.target.value)}
                          value={leadProductType}
                        >
                          <option value="">Select product type</option>
                          <option value="Mobile">Mobile</option>
                          <option value="Fixed">Fixed</option>
                          <option value="Solution">Solution</option>
                          <option value="Managed Services">Managed Services</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-whatsapp-muted">Package</span>
                        <input
                          className="input-glass mt-1"
                          onChange={(event) => setLeadPackageName(event.target.value)}
                          placeholder="Starter, Premium, Family..."
                          value={leadPackageName}
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-whatsapp-muted">Price</span>
                        <input
                          className="input-glass mt-1"
                          min="0"
                          onChange={(event) => setLeadPrice(event.target.value)}
                          placeholder="0.00"
                          step="0.01"
                          type="number"
                          value={leadPrice}
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-whatsapp-muted">Quantity</span>
                        <input
                          className="input-glass mt-1"
                          min="1"
                          onChange={(event) => setLeadQuantity(event.target.value)}
                          step="1"
                          type="number"
                          value={leadQuantity}
                        />
                      </label>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <button
                        className="primary-button"
                        disabled={savingSalesLeadItem}
                        onClick={() => void handleCreateSalesLead()}
                        type="button"
                      >
                        {savingSalesLeadItem ? "Saving..." : "Save sales lead"}
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => setExpandedLeadRegistrationMessageId(null)}
                        type="button"
                      >
                        Close
                      </button>
                    </div>

                    {leadFormError ? <p className="mt-3 text-sm text-rose-500">{leadFormError}</p> : null}

                    <div className="mt-4 border-t border-whatsapp-line pt-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-whatsapp-deep">Registered products</p>
                        <span className="text-xs text-whatsapp-muted">{salesLeadItems.length} item(s)</span>
                      </div>

                      {loadingSalesLeadItems ? (
                        <p className="mt-3 text-sm text-whatsapp-muted">Loading registered products...</p>
                      ) : salesLeadItems.length === 0 ? (
                        <p className="mt-3 text-sm text-whatsapp-muted">No products registered for this customer yet.</p>
                      ) : (
                        <div className="mt-3 space-y-2">
                          {salesLeadItems.map((salesItem) => {
                            const total = salesItem.price * salesItem.quantity;

                            return (
                              <div key={salesItem.id} className="rounded-xl border border-whatsapp-line bg-whatsapp-canvas p-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold text-ink">{salesItem.product_type}</p>
                                    <p className="mt-1 text-xs text-whatsapp-muted">{salesItem.package_name}</p>
                                  </div>
                                  {salesLeadStatus ? (
                                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] shadow-soft ${getLeadStatusBadgeClasses(salesLeadStatus)}`}>
                                      {CUSTOMER_STATUS_LABELS[salesLeadStatus]}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-3 grid gap-2 text-xs text-whatsapp-muted sm:grid-cols-3">
                                  <div className="rounded-lg border border-whatsapp-line bg-white px-3 py-2">
                                    <p className="uppercase tracking-[0.14em]">Unit price</p>
                                    <p className="mt-1 text-sm font-semibold text-ink">{formatCurrency(salesItem.price)}</p>
                                  </div>
                                  <div className="rounded-lg border border-whatsapp-line bg-white px-3 py-2">
                                    <p className="uppercase tracking-[0.14em]">Quantity</p>
                                    <p className="mt-1 text-sm font-semibold text-ink">{salesItem.quantity}</p>
                                  </div>
                                  <div className="rounded-lg border border-whatsapp-line bg-white px-3 py-2">
                                    <p className="uppercase tracking-[0.14em]">Total</p>
                                    <p className="mt-1 text-sm font-semibold text-ink">{formatCurrency(total)}</p>
                                  </div>
                                </div>
                                <p className="mt-2 text-[11px] text-whatsapp-muted">Saved {formatSalesLeadTimestamp(salesItem.created_at)}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
              );
            })}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="relative z-10 mt-3 space-y-2">
        {showQuickReplies ? (
          <div className="rounded-xl border border-whatsapp-line bg-white p-3 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink">Quick replies</p>
              <button
                className="text-xs font-medium text-whatsapp-muted transition hover:text-whatsapp-deep"
                onClick={() => setShowQuickReplies(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <div className="custom-scrollbar mt-3 max-h-36 overflow-y-auto pr-1">
              <div className="flex flex-wrap gap-2">
              {quickReplies.map((reply) => (
                <div key={reply.id} className="flex items-center gap-1 rounded-full border border-whatsapp-line bg-[#f8f5f2] pr-1 shadow-soft">
                  <button
                    className="rounded-full px-3 py-2 text-left text-sm text-ink/80 transition hover:bg-white"
                    onClick={() => void handlePickQuickReply(reply)}
                    type="button"
                  >
                    {reply.attachment ? `[Attachment] ${getQuickReplyContentLabel(reply)}` : getQuickReplyContentLabel(reply)}
                  </button>
                  <button
                    aria-label={`Delete quick reply: ${getQuickReplyContentLabel(reply)}`}
                    className="icon-hover-trigger flex h-8 w-8 items-center justify-center rounded-full text-whatsapp-muted transition hover:bg-white hover:text-rose-500"
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
                className="icon-hover-trigger flex h-10 w-10 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted transition hover:text-whatsapp-deep"
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
                className="icon-hover-trigger flex h-10 w-10 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted transition hover:text-whatsapp-deep"
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
                    className="quick-reply-chip border border-whatsapp-line bg-white px-3 py-2 text-xl leading-none transition hover:bg-whatsapp-soft"
                    onClick={() => setNewQuickReply((current) => `${current}${emoji}`)}
                    type="button"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
            {newQuickReplyAttachment ? (
              <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-whatsapp-line bg-[#f8f5f2] px-3 py-2 text-sm text-ink/80">
                <span className="truncate">Attached: {newQuickReplyAttachment.name}</span>
                <button
                  className="text-xs font-medium text-whatsapp-muted transition hover:text-whatsapp-deep"
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
          <div className="rounded-xl border border-whatsapp-line bg-white p-3 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink">Attachments</p>
              <button
                className="text-xs font-medium text-whatsapp-muted transition hover:text-whatsapp-deep"
                onClick={() => setShowAttachmentMenu(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="mt-3">{attachmentPanelContent}</div>
          </div>
        ) : null}

        {showEmojiPicker ? (
          <div className="rounded-xl border border-whatsapp-line bg-white p-3 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink">Emojis</p>
              <button
                className="text-xs font-medium text-whatsapp-muted transition hover:text-whatsapp-deep"
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
                  className="icon-hover-trigger quick-reply-chip border border-whatsapp-line bg-white px-3 py-2 text-xl leading-none transition hover:bg-whatsapp-soft"
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

        <div className="rounded-xl border border-whatsapp-line bg-white p-2 shadow-soft">
          <div className="flex items-center gap-2">
          <button
            className={`icon-hover-trigger flex h-10 w-10 shrink-0 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-whatsapp-deep focus:bg-transparent sm:h-11 sm:w-11 ${
              showQuickReplies ? "text-whatsapp-deep" : ""
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
            className={`icon-hover-trigger flex h-10 w-10 shrink-0 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-whatsapp-deep focus:bg-transparent sm:h-11 sm:w-11 ${
              showAttachmentMenu ? "text-whatsapp-deep" : ""
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
            className={`icon-hover-trigger flex h-10 w-10 shrink-0 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-whatsapp-deep focus:bg-transparent sm:h-11 sm:w-11 ${
              showEmojiPicker ? "text-whatsapp-deep" : ""
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

      {mediaLightbox ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#10211d]/78 px-4 py-6 backdrop-blur-sm"
          onClick={() => setMediaLightbox(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          <div
            className="relative max-h-full w-full max-w-5xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
              <button
                className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-whatsapp-deep shadow-soft transition hover:bg-whatsapp-soft"
                onClick={() => openMediaInNewTab(mediaLightbox.src)}
                type="button"
              >
                Open in new tab
              </button>
              <a
                className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-whatsapp-deep shadow-soft transition hover:bg-whatsapp-soft"
                download={mediaLightbox.downloadName}
                href={mediaLightbox.src}
              >
                Save picture
              </a>
              <button
                className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-whatsapp-deep shadow-soft transition hover:bg-whatsapp-soft"
                onClick={() => setMediaLightbox(null)}
                type="button"
              >
                Close
              </button>
            </div>
            <img
              alt={mediaLightbox.alt}
              className="max-h-[88vh] w-full rounded-[28px] object-contain shadow-soft"
              src={mediaLightbox.src}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
