import React, { useState } from "react";

interface CustomerEditModalProps {
  customer: any;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updated: any) => void;
}

const statusOptions = [
  "new_lead",
  "interested",
  "processing",
  "closed_won",
  "closed_lost"
];

export default function CustomerEditModal({ customer, isOpen, onClose, onSave }: CustomerEditModalProps) {
  const [form, setForm] = useState({
    contact_name: customer?.contact_name || "",
    status: customer?.status || "new_lead",
    notes: customer?.notes || "",
    profile_picture_url: customer?.profile_picture_url || "",
    about: customer?.about || "",
    premise_address: customer?.premise_address || "",
    business_type: customer?.business_type || "",
    age: customer?.age || "",
    email_address: customer?.email_address || ""
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  if (!isOpen) return null;

  return (
    <div className="frost-float-backdrop fixed inset-0 z-50 flex items-center justify-center px-4 py-6" onClick={onClose}>
      <form
        className="frost-float w-full max-w-sm rounded-[18px] p-4"
        style={{ maxWidth: 360 }}
        onSubmit={handleSubmit}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-2 text-lg font-semibold">Edit Customer Profile</h2>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Name</label>
          <input name="contact_name" value={form.contact_name} onChange={handleChange} className="input input-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Status</label>
          <select name="status" value={form.status} onChange={handleChange} className="input input-sm">
            {statusOptions.map(opt => <option key={opt} value={opt}>{opt.replace("_", " ")}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Notes</label>
          <textarea name="notes" value={form.notes} onChange={handleChange} className="input input-sm" rows={2} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Profile Picture URL</label>
          <input name="profile_picture_url" value={form.profile_picture_url} onChange={handleChange} className="input input-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">About</label>
          <input name="about" value={form.about} onChange={handleChange} className="input input-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Premise Address</label>
          <input name="premise_address" value={form.premise_address} onChange={handleChange} className="input input-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Business Type</label>
          <input name="business_type" value={form.business_type} onChange={handleChange} className="input input-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Age</label>
          <input name="age" type="number" min="0" value={form.age} onChange={handleChange} className="input input-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Email Address</label>
          <input name="email_address" type="email" value={form.email_address} onChange={handleChange} className="input input-sm" />
        </div>
        <div className="flex flex-col gap-1 mt-2">
          <label className="text-xs font-medium">Phone (WhatsApp)</label>
          <input value={customer.phone} disabled className="input input-sm bg-gray-100" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Chat JID</label>
          <input value={customer.chat_jid} disabled className="input input-sm bg-gray-100" />
        </div>
        <div className="mt-4 flex flex-row gap-2">
          <button type="button" className="btn btn-sm flex-1 bg-gray-200" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-sm flex-1 bg-green-500 text-white">Save</button>
        </div>
      </form>
    </div>
  );
}
