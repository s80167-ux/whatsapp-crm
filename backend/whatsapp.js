
const { Boom } = require('@hapi/boom');
const fs = require('fs/promises');
const path = require('path');
const QRCode = require('qrcode');
const { saveMessage, upsertCustomer, getCustomerOwnerIdsByPhone } = require('./supabase');

let sock = null;
let qrData = null;
let connectionState = 'connecting';
let baileysModulePromise = null;
let reconnectTimer = null;
let resetAuthPromise = null;
let activeOwnerUserId = null;

const authDir = process.env.WHATSAPP_AUTH_DIR
	? path.resolve(process.env.WHATSAPP_AUTH_DIR)
	: path.join(__dirname, 'baileys_auth');

async function loadBaileys() {
	if (!baileysModulePromise) {
		baileysModulePromise = import('@whiskeysockets/baileys').then((module) => ({
			makeWASocket: module.default,
			useMultiFileAuthState: module.useMultiFileAuthState,
			fetchLatestBaileysVersion: module.fetchLatestBaileysVersion,
			DisconnectReason: module.DisconnectReason
		}));
	}

	return baileysModulePromise;
}

function normalizePhone(rawPhone) {
	return String(rawPhone || '').replace(/\D/g, '');
}

function bindWhatsAppOwner(ownerUserId) {
	if (!ownerUserId) return;
	activeOwnerUserId = ownerUserId;
}

function extractIncomingText(message) {
	if (!message) return '';

	return (
		message.conversation ||
		message.extendedTextMessage?.text ||
		message.imageMessage?.caption ||
		message.videoMessage?.caption ||
		message.documentMessage?.caption ||
		message.buttonsResponseMessage?.selectedDisplayText ||
		message.listResponseMessage?.title ||
		message.templateButtonReplyMessage?.selectedDisplayText ||
		''
	);
}

function extractContactName(msg) {
	const candidates = [
		msg?.pushName,
		msg?.verifiedBizName,
		msg?.message?.contactMessage?.displayName,
		msg?.message?.contactsArrayMessage?.displayName
	];

	for (const candidate of candidates) {
		const normalized = String(candidate || '').trim();
		if (normalized) {
			return normalized;
		}
	}

	return null;
}

async function resolveOwnerUserIds(phone) {
	const ownerUserIds = await getCustomerOwnerIdsByPhone(phone);
	if (ownerUserIds.length > 0) {
		return ownerUserIds;
	}

	return activeOwnerUserId ? [activeOwnerUserId] : [];
}

async function persistIncomingMessage(msg) {
	if (!msg?.message || !msg?.key?.remoteJid || msg.key.fromMe) return;
	if (msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid.endsWith('@g.us')) return;

	const phone = normalizePhone(msg.key.remoteJid.split('@')[0]);
	const text = extractIncomingText(msg.message).trim();
	const contactName = extractContactName(msg);
	if (!phone || !text) return;

	const ownerUserIds = await resolveOwnerUserIds(phone);
	if (!ownerUserIds.length) return;

	for (const ownerUserId of ownerUserIds) {
		await upsertCustomer({
			owner_user_id: ownerUserId,
			phone,
			chat_jid: msg.key.remoteJid,
			...(contactName ? { contact_name: contactName } : {})
		});

		await saveMessage({
			owner_user_id: ownerUserId,
			phone,
			chat_jid: msg.key.remoteJid,
			wa_message_id: msg.key.id,
			message: text,
			direction: 'incoming'
		});
	}
}

async function resetAuthState() {
	if (!resetAuthPromise) {
		resetAuthPromise = (async () => {
			await fs.rm(authDir, { recursive: true, force: true });
			await fs.mkdir(authDir, { recursive: true });
		})().finally(() => {
			resetAuthPromise = null;
		});
	}

	return resetAuthPromise;
}

function scheduleReconnect({ resetAuth = false } = {}) {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
	}

	connectionState = 'connecting';
	reconnectTimer = setTimeout(async () => {
		reconnectTimer = null;
		try {
			if (resetAuth) {
				await resetAuthState();
			}
			await initializeWhatsApp();
		} catch (error) {
			console.error('Failed to reinitialize WhatsApp:', error);
			connectionState = 'disconnected';
		}
	}, 3000);
}

async function initializeWhatsApp() {
	if (sock) return sock;

	connectionState = 'connecting';
	qrData = null;

	const {
		makeWASocket,
		useMultiFileAuthState,
		fetchLatestBaileysVersion,
		DisconnectReason
	} = await loadBaileys();

	await fs.mkdir(authDir, { recursive: true });
	const { state, saveCreds } = await useMultiFileAuthState(authDir);
	const { version } = await fetchLatestBaileysVersion();

	sock = makeWASocket({
		version,
		printQRInTerminal: false,
		auth: state,
		syncFullHistory: false,
		getMessage: async () => undefined
	});

	sock.ev.on('creds.update', saveCreds);

	sock.ev.on('connection.update', async (update) => {
		const { connection, lastDisconnect, qr } = update;
		if (connection === 'connecting') {
			connectionState = 'connecting';
		}
		if (qr) {
			qrData = await QRCode.toDataURL(qr);
			connectionState = 'qr';
		}
		if (connection === 'open') {
			connectionState = 'open';
			qrData = null;
			console.log('WhatsApp (Baileys) is ready.');
		} else if (connection === 'close') {
			const statusCode = lastDisconnect?.error instanceof Boom
				? lastDisconnect.error.output.statusCode
				: undefined;
			qrData = null;
			sock = null;
			if (statusCode === DisconnectReason.loggedOut) {
				console.warn('WhatsApp session was logged out. Resetting auth state to generate a fresh QR.');
				scheduleReconnect({ resetAuth: true });
				return;
			}

			connectionState = 'disconnected';
			if (statusCode !== DisconnectReason.loggedOut) {
				scheduleReconnect();
			}
		}
	});

	sock.ev.on('messages.upsert', async ({ messages, type }) => {
		if (!['notify', 'append'].includes(type) || !Array.isArray(messages) || messages.length === 0) return;

		for (const msg of messages) {
			try {
				await persistIncomingMessage(msg);
			} catch (e) {
				console.error('Failed to save incoming message:', e.message);
			}
		}
	});

	return sock;
}

function getWhatsAppStatus() {
	return {
		connected: connectionState === 'open',
		state: connectionState,
		hasQr: Boolean(qrData)
	};
}

function getWhatsAppQr() {
	return {
		connected: connectionState === 'open',
		state: connectionState,
		qr: qrData
	};
}

async function sendMessageToPhone(phone, message, chatJid) {
	if (!sock || connectionState !== 'open') throw new Error('WhatsApp is not connected.');
	const jid = chatJid || phone + '@s.whatsapp.net';
	const res = await sock.sendMessage(jid, { text: String(message) });
	return res;
}

async function sendAttachmentToPhone({ phone, chatJid, buffer, mimeType, fileName, caption }) {
	if (!sock || connectionState !== 'open') throw new Error('WhatsApp is not connected.');
	const jid = chatJid || phone + '@s.whatsapp.net';
	const type = (mimeType || '').startsWith('image/') ? 'image' : 'document';
	const msg = type === 'image'
		? { image: buffer, mimetype: mimeType, fileName, caption }
		: { document: buffer, mimetype: mimeType, fileName, caption };
	return await sock.sendMessage(jid, msg);
}

async function sendLocationToPhone({ phone, chatJid, latitude, longitude, name, address }) {
	if (!sock || connectionState !== 'open') throw new Error('WhatsApp is not connected.');
	const jid = chatJid || phone + '@s.whatsapp.net';
	return await sock.sendMessage(jid, {
		location: { degreesLatitude: Number(latitude), degreesLongitude: Number(longitude), name, address }
	});
}

async function getContactProfile(phone, chatJid) {
	if (!sock || connectionState !== 'open') return { profilePictureUrl: null, about: null };
	const jid = chatJid || phone + '@s.whatsapp.net';
	try {
		const profilePictureUrl = await sock.profilePictureUrl(jid, 'image').catch(() => null);
		// Baileys does not provide 'about' directly
		return { profilePictureUrl, about: null };
	} catch {
		return { profilePictureUrl: null, about: null };
	}
}

module.exports = {
	initializeWhatsApp,
	sendMessageToPhone,
	sendAttachmentToPhone,
	sendLocationToPhone,
	getWhatsAppStatus,
	getWhatsAppQr,
	getContactProfile,
	bindWhatsAppOwner,
	normalizePhone
};
