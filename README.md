# whatsapp-crm

WhatsApp CRM MVP with:

- `backend/`: Node.js + Express + Supabase + Baileys + JWT auth
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
- `WHATSAPP_AUTH_DIR=optional_path_for_baileys_session_storage`

## 2. Backend Install

```bash
cd backend
npm install
npm run dev
```

Backend will run on `http://localhost:4000`.

When Baileys starts, open the frontend QR card and scan it with WhatsApp.

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
- outgoing messages are saved after successful WhatsApp send
- `Customer info` status and notes are UI-only for now
- `backend/baileys_auth/` stores the Baileys session by default

## Railway

Deploy the backend to Railway with a persistent volume for the WhatsApp auth state.

- Mount a persistent volume and point `WHATSAPP_AUTH_DIR` to that mounted path.
- Keep `npm start` as the backend start command.
- If the auth directory is not persisted, WhatsApp will require a fresh QR login after redeploys.

### Backend Service Setup

Deploy the `backend/` directory as its own Railway service.

- Use [backend/railway.json](backend/railway.json) as the service config.
- Use `backend/.env.railway.example` as the template for Railway environment variables.
- Attach a persistent volume and mount it at `/data`.
- Set `WHATSAPP_AUTH_DIR=/data/baileys_auth` so the Baileys login survives redeploys.
- Set `FRONTEND_URL` to your Vercel production domain for CORS.

Required Railway environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `FRONTEND_URL`
- `WHATSAPP_AUTH_DIR=/data/baileys_auth`

Optional:

- `PORT` (Railway usually injects this automatically)

### Connect Vercel Frontend To Railway Backend

After Railway gives you a public backend URL, set it in the Vercel frontend as `VITE_API_URL`, then redeploy the frontend.

Set `VITE_PUBLIC_APP_URL` to your public frontend domain so Supabase verification emails and other auth redirects always point at the live app, even if the action is triggered from localhost during development.

Example:

```bash
cd frontend
npx vercel env add VITE_API_URL production
npx vercel env add VITE_PUBLIC_APP_URL production
npx vercel --prod
```

Use your Railway backend URL as the `VITE_API_URL` value, for example `https://your-backend.up.railway.app`.
Use your public frontend URL as the `VITE_PUBLIC_APP_URL` value, for example `https://rezekicrm.vercel.app`.
