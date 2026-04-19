import { createPortal } from "react-dom";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { CONTACT_STATUSES, type ContactStatus, type Customer } from "../lib/api";

interface CustomerEditModalProps {
  customer: Customer | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updated: {
    phone: string;
    chat_jid?: string | null;
    contact_name?: string | null;
    status: Customer["status"];
    contact_status?: ContactStatus | null;
    notes: string;
    profile_picture_url?: string | null;
    about?: string | null;
    premise_address?: string | null;
    business_type?: string | null;
    age?: number | null;
    email_address?: string | null;
  }) => Promise<void> | void;
}

const contactStatusOptions = [...CONTACT_STATUSES];

function getDefaultContactStatus(customer: Customer | null): ContactStatus {
  if (customer?.contact_status && CONTACT_STATUSES.includes(customer.contact_status)) {
    return customer.contact_status;
  }

  switch (customer?.status) {
    case "interested":
      return "\u{1F525} Interested";
    case "processing":
      return "\u{1F680} Advanced";
    case "closed_won":
      return "\u{1F6D2} Customer";
    case "closed_lost":
      return "\u{274C} Lost / Not Interested";
    case "new_lead":
    default:
      return "\u{1F195} Lead";
  }
}

type FormState = {
  contact_name: string;
  contact_status: ContactStatus;
  notes: string;
  profile_picture_url: string;
  about: string;
  premise_address: string;
  business_type: string;
  age: string;
  email_address: string;
};

function buildFormState(customer: Customer | null): FormState {
  return {
    contact_name: customer?.contact_name || "",
    contact_status: getDefaultContactStatus(customer),
    notes: customer?.notes || "",
    profile_picture_url: customer?.profile_picture_url || "",
    about: customer?.about || "",
    premise_address: customer?.premise_address || "",
    business_type: customer?.business_type || "",
    age: customer?.age === null || customer?.age === undefined ? "" : String(customer.age),
    email_address: customer?.email_address || ""
  };
}

function getInitials(contactName: string | null, phone: string | null) {
  const source = contactName || phone || "?";
  const parts = source
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) {
    return "?";
  }

  return parts.map((part) => part[0]?.toUpperCase() || "").join("");
}

export default function CustomerEditModal({ customer, isOpen, onClose, onSave }: CustomerEditModalProps) {
  const [form, setForm] = useState<FormState>(() => buildFormState(customer));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setForm(buildFormState(customer));
    setSaving(false);
    setError("");
  }, [customer, isOpen]);

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!customer?.phone) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      await onSave({
        phone: customer.phone,
        chat_jid: customer.chat_jid || null,
        contact_name: form.contact_name.trim() || null,
        status: customer.status,
        contact_status: form.contact_status,
        notes: form.notes,
        profile_picture_url: form.profile_picture_url.trim() || null,
        about: form.about.trim() || null,
        premise_address: form.premise_address.trim() || null,
        business_type: form.business_type.trim() || null,
        age: form.age.trim() ? Number(form.age) : null,
        email_address: form.email_address.trim() || null
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save customer.");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !customer) {
    return null;
  }

  const initials = getInitials(form.contact_name || customer.contact_name || null, customer.phone);
  const fieldClassName =
    "input-glass min-h-[46px] rounded-2xl border-white/60 bg-white/90 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] transition focus:border-whatsapp-dark/50 focus:bg-white";
  const textareaClassName = `${fieldClassName} min-h-[110px] resize-none`;
  const disabledFieldClassName = `${fieldClassName} bg-[#f6f3ef] text-whatsapp-muted`;

  return createPortal(
    <div
      aria-hidden="true"
      className="frost-float-backdrop fixed inset-0 z-[44]"
      onClick={onClose}
    >
      <div
        aria-label="Edit Customer Profile"
        aria-modal="true"
        className="whatsapp-popover fixed left-1/2 top-1/2 z-[45] w-[calc(100vw-24px)] max-w-[580px] -translate-x-1/2 -translate-y-1/2 overflow-hidden max-h-[calc(100dvh-24px)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <form
          className="whatsapp-popover-content scrollbar-hidden space-y-4 max-h-[calc(100dvh-24px)] overflow-y-auto overscroll-contain"
          onSubmit={handleSubmit}
        >
          <div className="relative overflow-hidden rounded-[24px] border border-white/70 bg-[linear-gradient(135deg,rgba(37,211,102,0.16),rgba(255,255,255,0.92)_38%,rgba(18,140,126,0.08))] p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
            <div aria-hidden="true" className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-white/45 blur-2xl" />
            <div className="relative flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] bg-whatsapp-dark text-base font-semibold text-white shadow-soft">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="whatsapp-popover-kicker">Customer profile</p>
                  <h2 className="whatsapp-popover-title">Edit contact details</h2>
                  <p className="whatsapp-popover-subtitle">Keep CRM data up to date without leaving the dashboard.</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-whatsapp-dark/80">
                    <span className="rounded-full border border-white/80 bg-white/75 px-3 py-1 font-semibold shadow-sm">{customer.phone}</span>
                    {customer.chat_jid ? (
                      <span className="rounded-full border border-white/80 bg-white/60 px-3 py-1 font-medium shadow-sm">{customer.chat_jid}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {error ? <div className="whatsapp-popover-card border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">{error}</div> : null}

          <div className="space-y-4">
            <section className="whatsapp-popover-card space-y-4 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-whatsapp-dark/65">Identity</p>
                  <p className="mt-1 text-xs text-whatsapp-muted">The main profile details shown across the dashboard.</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="contact_name" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-whatsapp-dark/70">
                    Name
                  </label>
                  <input
                    id="contact_name"
                    name="contact_name"
                    value={form.contact_name}
                    onChange={handleChange}
                    className={fieldClassName}
                    placeholder="Full name"
                    title="Contact name"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="contact_status" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-whatsapp-dark/70">
                    Contact Status
                  </label>
                  <select
                    id="contact_status"
                    name="contact_status"
                    value={form.contact_status}
                    onChange={handleChange}
                    className={fieldClassName}
                    title="Contact status"
                  >
                    {contactStatusOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="age" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-whatsapp-dark/70">
                    Age
                  </label>
                  <input id="age" name="age" type="number" min="0" value={form.age} onChange={handleChange} className={fieldClassName} title="Age" />
                </div>

                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="about" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-whatsapp-dark/70">
                    About
                  </label>
                  <textarea
                    id="about"
                    name="about"
                    value={form.about}
                    onChange={handleChange}
                    className={textareaClassName}
                    placeholder="Short bio or customer context"
                    rows={3}
                    title="About"
                  />
                </div>

                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="profile_picture_url" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-whatsapp-dark/70">
                    Profile Picture URL
                  </label>
                  <input
                    id="profile_picture_url"
                    name="profile_picture_url"
                    value={form.profile_picture_url}
                    onChange={handleChange}
                    className={fieldClassName}
                    placeholder="https://..."
                    title="Profile picture URL"
                  />
                </div>
              </div>
            </section>

            <section className="whatsapp-popover-card space-y-4 p-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-whatsapp-dark/65">Business Details</p>
                <p className="mt-1 text-xs text-whatsapp-muted">Useful context for sales follow-up and segmentation.</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="premise_address" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-whatsapp-dark/70">
                    Premise Address
                  </label>
                  <input
                    id="premise_address"
                    name="premise_address"
                    value={form.premise_address}
                    onChange={handleChange}
                    className={fieldClassName}
                    placeholder="Premise address"
                    title="Premise address"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="business_type" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-whatsapp-dark/70">
                    Business Type
                  </label>
                  <input
                    id="business_type"
                    name="business_type"
                    value={form.business_type}
                    onChange={handleChange}
                    className={fieldClassName}
                    placeholder="Business type"
                    title="Business type"
                  />
                </div>

                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="email_address" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-whatsapp-dark/70">
                    Email Address
                  </label>
                  <input
                    id="email_address"
                    name="email_address"
                    type="email"
                    value={form.email_address}
                    onChange={handleChange}
                    className={fieldClassName}
                    placeholder="Email address"
                    title="Email address"
                  />
                </div>
              </div>
            </section>

            <section className="whatsapp-popover-card space-y-4 p-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-whatsapp-dark/65">Notes</p>
                <p className="mt-1 text-xs text-whatsapp-muted">Internal CRM notes for your team.</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="notes" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-whatsapp-dark/70">
                  Notes
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  value={form.notes}
                  onChange={handleChange}
                  className={textareaClassName}
                  placeholder="Important details, preferences, follow-up reminders..."
                  rows={4}
                  title="Notes"
                />
              </div>
            </section>

            <section className="whatsapp-popover-card space-y-4 border-dashed p-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-whatsapp-dark/65">Read Only</p>
                <p className="mt-1 text-xs text-whatsapp-muted">Stable identifiers from WhatsApp sync.</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="phone" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-whatsapp-dark/70">
                    Phone (WhatsApp)
                  </label>
                  <input id="phone" value={customer.phone} disabled className={disabledFieldClassName} title="Phone (WhatsApp)" />
                </div>

                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="chat_jid" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-whatsapp-dark/70">
                    Chat JID
                  </label>
                  <input id="chat_jid" value={customer.chat_jid || ""} disabled className={disabledFieldClassName} title="Chat JID" />
                </div>
              </div>
            </section>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              className="secondary-button w-full rounded-[14px] px-3 py-3 text-sm font-semibold"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="primary-button w-full justify-center rounded-[14px] py-3 text-sm font-semibold" disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
