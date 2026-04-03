# whatsapp-crm

WhatsApp CRM MVP with:

- `backend/`: Node.js + Express + Supabase + whatsapp-web.js + JWT auth
- `frontend/`: React + TypeScript + Vite + Tailwind glass UI

## Project Structure

```text
whatsapp-crm/
  backend/
  frontend/
```

## 1. Supabase Setup

Create these tables in Supabase using `backend/sql/schema.sql`.
User authentication is handled by Supabase Auth.

Required backend env values:

- `SUPABASE_URL=https://kavumbilqekhzkzzxnhc.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=your_service_role_key`
- `SUPABASE_PUBLISHABLE_KEY=optional_fallback_for_local_mvp`
- `PUPPETEER_EXECUTABLE_PATH=optional_path_to_local_chrome_or_edge`

## 2. Backend Install

```bash
cd backend
npm install
npm run dev
```

Backend will run on `http://localhost:4000`.

When `whatsapp-web.js` starts, open the frontend QR card and scan it with WhatsApp.

## 3. Frontend Install

```bash
cd frontend
npm install
npm run dev
```

Frontend will run on `http://localhost:5173`.

## 4. Default Flow

1. Create an account or log in from the frontend with Supabase Auth
2. Scan the WhatsApp QR in the backend terminal
3. Incoming messages are stored in Supabase
4. Use the dashboard to fetch conversations, search chats, and send replies

## Notes

- `users.password` stores a bcrypt hash
- `messages.phone` is the conversation key
- outgoing messages are saved after successful WhatsApp Web send
- `Customer info` status and notes are UI-only for now
- `backend/wwebjs_auth/` stores the WhatsApp Web session
- If Puppeteer cannot download Chrome automatically, set `PUPPETEER_EXECUTABLE_PATH` to your local browser executable
