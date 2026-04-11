// Type definitions for ChatWindow component

export type StoredQuickReplyAttachment = {
  name: string;
  type: string;
  dataUrl: string;
};

export type AttachmentTab = "image" | "sticker" | "document" | "location";

import { CustomerStatus, Message, SalesLeadItem } from "../lib/api";

export interface ChatWindowProps {
  contactName: string | null;
  phone: string | null;
  chatJid: string | null;
  profilePictureUrl?: string | null;
  messages: Message[];
  deletingMessageId?: string | null;
  salesLeadItems?: SalesLeadItem[];
  salesLeadStatus?: CustomerStatus;
  messageFilterId?: string | null;
  onClearMessageFilter?: () => void;
  loadingSalesLeadItems?: boolean;
  savingSalesLeadItem?: boolean;
  messageText: string;
  loading?: boolean;
  sending?: boolean;
  customerPanelProps?: any;
  onChangeMessage: (value: string) => void;
  onCreateSalesLeadItem?: (item: any) => Promise<void>;
  onUpdateSalesLeadItem?: (item: any) => Promise<void>;
  onDeleteMessage?: (message: Message) => void;
  onSend: () => void;
  onSendQuickReply: (text: string) => Promise<void>;
  onSendAttachment: (file: File, caption?: string | undefined) => Promise<void>;
  onSendLocation: (location: { latitude: number; longitude: number; name?: string; address?: string }) => Promise<void>;
}
