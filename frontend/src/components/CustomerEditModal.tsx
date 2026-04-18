import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import type { Customer } from "../lib/api";

interface CustomerEditModalProps {
  customer: Customer | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updated: {
    phone: string;
    chat_jid?: string | null;
    contact_name?: string | null;
    status: Customer["status"];
    notes: string;
    profile_picture_url?: string | null;
    about?: string | null;
    premise_address?: string | null;
    business_type?: string | null;
    age?: number | null;
    email_address?: string | null;
  }) => Promise<void> | void;
}

const statusOptions: Customer["status"][] = ["new_lead", "interested", "processing", "closed_won", "closed_lost"];

type FormState = {
  contact_name: string;
  status: Customer["status"];
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
    status: customer?.status || "new_lead",
    notes: customer?.notes || "",
    profile_picture_url: customer?.profile_picture_url || "",
    about: customer?.about || "",
    premise_address: customer?.premise_address || "",
    business_type: customer?.business_type || "",
    age: customer?.age === null || customer?.age === undefined ? "" : String(customer.age),
    email_address: customer?.email_address || ""
  };
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
        status: form.status,
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

  return (
    <div className="frost-float-backdrop fixed inset-0 z-50 flex items-center justify-center px-4 py-6" onClick={onClose}>
      <form
        aria-label="Edit Customer Profile"
        className="frost-float w-full max-w-xl rounded-[18px] p-4"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Edit Customer Profile</h2>
            <p className="mt-1 text-xs text-whatsapp-muted">Update the fields that matter for CRM follow-up.</p>
          </div>
          <button
            aria-label="Close editor"
            className="rounded-full border border-whatsapp-line bg-white px-3 py-1 text-xs text-whatsapp-muted transition hover:bg-whatsapp-canvas hover:text-whatsapp-deep"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        {error ? <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="contact_name" className="text-xs font-medium">
              Name
            </label>
            <input
              id="contact_name"
              name="contact_name"
              value={form.contact_name}
              onChange={handleChange}
              className="input input-sm"
              placeholder="Full name"
              title="Contact name"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="status" className="text-xs font-medium">
              Status
            </label>
            <select id="status" name="status" value={form.status} onChange={handleChange} className="input input-sm" title="Customer status">
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="age" className="text-xs font-medium">
              Age
            </label>
            <input id="age" name="age" type="number" min="0" value={form.age} onChange={handleChange} className="input input-sm" title="Age" />
          </div>

          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="notes" className="text-xs font-medium">
              Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              value={form.notes}
              onChange={handleChange}
              className="input input-sm min-h-[88px]"
              placeholder="Notes"
              rows={3}
              title="Notes"
            />
          </div>

          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="profile_picture_url" className="text-xs font-medium">
              Profile Picture URL
            </label>
            <input
              id="profile_picture_url"
              name="profile_picture_url"
              value={form.profile_picture_url}
              onChange={handleChange}
              className="input input-sm"
              placeholder="Profile picture URL"
              title="Profile picture URL"
            />
          </div>

          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="about" className="text-xs font-medium">
              About
            </label>
            <textarea
              id="about"
              name="about"
              value={form.about}
              onChange={handleChange}
              className="input input-sm min-h-[80px]"
              placeholder="About"
              rows={3}
              title="About"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="premise_address" className="text-xs font-medium">
              Premise Address
            </label>
            <input
              id="premise_address"
              name="premise_address"
              value={form.premise_address}
              onChange={handleChange}
              className="input input-sm"
              placeholder="Premise address"
              title="Premise address"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="business_type" className="text-xs font-medium">
              Business Type
            </label>
            <input
              id="business_type"
              name="business_type"
              value={form.business_type}
              onChange={handleChange}
              className="input input-sm"
              placeholder="Business type"
              title="Business type"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="email_address" className="text-xs font-medium">
              Email Address
            </label>
            <input
              id="email_address"
              name="email_address"
              type="email"
              value={form.email_address}
              onChange={handleChange}
              className="input input-sm"
              placeholder="Email address"
              title="Email address"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="phone" className="text-xs font-medium">
              Phone (WhatsApp)
            </label>
            <input id="phone" value={customer.phone} disabled className="input input-sm bg-gray-100" title="Phone (WhatsApp)" />
          </div>

          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="chat_jid" className="text-xs font-medium">
              Chat JID
            </label>
            <input id="chat_jid" value={customer.chat_jid || ""} disabled className="input input-sm bg-gray-100" title="Chat JID" />
          </div>
        </div>

        <div className="mt-4 flex flex-row gap-2">
          <button type="button" className="btn btn-sm flex-1 bg-gray-200" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-sm flex-1 bg-green-500 text-white" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
