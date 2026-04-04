
const { Boom } = require('@hapi/boom');
const fs = require('fs/promises');
const path = require('path');
const QRCode = require('qrcode');
const { saveMessage, upsertCustomer, getCustomerOwnerIdsByPhone } = require('./supabase');
const { normalizePhone, resolveWhatsAppPhone, extractDigits } = require('./wa-identifiers');

let sock = null;
let qrData = null;
let connectionState = 'connecting';
let baileysModulePromise = null;
let reconnectTimer = null;
let resetAuthPromise = null;
let activeOwnerUserId = null;
let manualDisconnectRequested = false;

function withTimeout(promise, timeoutMs, fallbackValue) {
	return Promise.race([
		promise,
		new Promise((resolve) => {
			setTimeout(() => resolve(fallbackValue), timeoutMs);
		})
	]);
}

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
	if (!msg?.message || !msg?.key?.remoteJid) return;
	if (msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid.endsWith('@g.us')) return;

	const phone = await resolveWhatsAppPhone(msg.key.remoteJid, msg.key.remoteJid);
	const text = extractIncomingText(msg.message).trim();
	const contactName = extractContactName(msg);
	if (!phone || !text) return;

	const ownerUserIds = await resolveOwnerUserIds(phone);
	if (!ownerUserIds.length) return;

	const tsSecs = Number(typeof msg.messageTimestamp === 'object' ? msg.messageTimestamp.low : msg.messageTimestamp);
	const created_at = tsSecs && !isNaN(tsSecs) ? new Date(tsSecs * 1000).toISOString() : undefined;

	for (const ownerUserId of ownerUserIds) {
		await upsertCustomer({
			owner_user_id: ownerUserId,
			phone,
			chat_jid: msg.key.remoteJid,
			...(contactName && !msg.key.fromMe ? { contact_name: contactName } : {})
		});

		await saveMessage({
			owner_user_id: ownerUserId,
			phone,
			chat_jid: msg.key.remoteJid,
			wa_message_id: msg.key.id,
			message: text,
			direction: msg.key.fromMe ? 'outgoing' : 'incoming',
			send_status: msg.key.fromMe ? 'sent' : undefined,
			created_at
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

function clearReconnectTimer() {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
}

function scheduleReconnect({ resetAuth = false } = {}) {
	clearReconnectTimer();

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
		syncFullHistory: true,
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

			setTimeout(async () => {
				if (!activeOwnerUserId) return;
				try {
					const profile = await getWhatsAppProfile();
					if (profile.connected) {
						await require('./supabase').upsertWhatsAppProfile({
							owner_user_id: activeOwnerUserId,
							phone: profile.phone,
							username: profile.username,
							profile_picture_url: profile.profilePictureUrl
						});
					}
				} catch (e) {
					console.error('Failed to save WhatsApp profile to database:', e.message);
				}
			}, 3000);
		} else if (connection === 'close') {
			const statusCode = lastDisconnect?.error instanceof Boom
				? lastDisconnect.error.output.statusCode
				: undefined;
			qrData = null;
			sock = null;
			if (manualDisconnectRequested) {
				connectionState = 'disconnected';
				return;
			}
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

	sock.ev.on('contacts.upsert', async (contacts) => {
		if (!Array.isArray(contacts)) return;
		for (const contact of contacts) {
			if (contact.id && contact.lid && !contact.id.endsWith('@g.us') && contact.id !== 'status@broadcast') {
				const phone = extractDigits(contact.id);
				const lidDigits = extractDigits(contact.lid);
				if (phone && lidDigits && lidDigits !== phone) {
					const reverseFile = path.join(authDir, `lid-mapping-${lidDigits}_reverse.json`);
					const fwdFile = path.join(authDir, `lid-mapping-${phone}.json`);
					await fs.writeFile(reverseFile, JSON.stringify(phone)).catch(() => {});
					await fs.writeFile(fwdFile, JSON.stringify(lidDigits)).catch(() => {});
				}
			}
		}
	});

	sock.ev.on('messaging-history.set', async ({ chats, contacts, messages, isLatest }) => {
		if (!activeOwnerUserId) return;
		try {
			const settings = await require('./supabase').getWhatsAppSettings(activeOwnerUserId);
			const days = settings.history_sync_days || 7;
			const cutoffSecs = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);

			if (Array.isArray(contacts)) {
				fs.writeFile(path.join(authDir, 'hist_contacts.json'), JSON.stringify(contacts, null, 2)).catch(() => {});
				fs.writeFile(path.join(authDir, 'hist_chats.json'), JSON.stringify(chats, null, 2)).catch(() => {});
				for (const contact of contacts) {
					if (contact.id && !contact.id.endsWith('@g.us') && contact.id !== 'status@broadcast') {
						const phone = await resolveWhatsAppPhone(contact.id, contact.id);

						if (contact.lid && phone) {
							const lidDigits = extractDigits(contact.lid);
							if (lidDigits && lidDigits !== phone) {
								const reverseFile = path.join(authDir, `lid-mapping-${lidDigits}_reverse.json`);
								const fwdFile = path.join(authDir, `lid-mapping-${phone}.json`);
								await fs.writeFile(reverseFile, JSON.stringify(phone)).catch(() => {});
								await fs.writeFile(fwdFile, JSON.stringify(lidDigits)).catch(() => {});
							}
						}

						if (phone) {
							const contactName = String(contact.name || contact.notify || contact.verifiedName || '').trim();
							if (contactName) {
								await require('./supabase').upsertCustomer({
									owner_user_id: activeOwnerUserId,
									phone,
									chat_jid: contact.id,
									contact_name: contactName
								}).catch(err => console.warn('Failed to upsert history contact', err.message));
							}
						}
					}
				}
			}

			const recentMessages = messages.filter(m => {
				const ts = typeof m.messageTimestamp === 'object' ? m.messageTimestamp.low : m.messageTimestamp;
				return Number(ts) >= cutoffSecs;
			});

			console.log(`History sync chunk received: ${messages.length} total messages, keeping ${recentMessages.length} recent (last ${days} days).`);

			for (const msg of recentMessages) {
				try {
					await persistIncomingMessage(msg);
				} catch (e) {
					console.error('Failed to save history message:', e.message);
				}
			}
		} catch (error) {
			console.error('Failed to process messaging-history.set:', error.message);
		}
	});

	return sock;
}

async function disconnectWhatsApp() {
	clearReconnectTimer();
	qrData = null;
	connectionState = 'disconnecting';
	manualDisconnectRequested = true;

	const currentSock = sock;
	sock = null;

	try {
		if (currentSock?.logout) {
			await withTimeout(currentSock.logout(), 5000, null);
		} else {
			await resetAuthState();
		}
	} catch (error) {
		console.warn('Failed to log out WhatsApp session cleanly:', error.message);
		await resetAuthState();
	} finally {
		manualDisconnectRequested = false;
	}

	scheduleReconnect({ resetAuth: true });
	return getWhatsAppStatus();
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

function getSelfJid() {
	return sock?.user?.id || null;
}

function extractPhoneFromJid(jid) {
	const rawValue = String(jid || '').split('@')[0].split(':')[0].trim();
	const digits = rawValue.replace(/\D+/g, '');
	return digits ? normalizePhone(digits) : null;
}

async function getWhatsAppProfile() {
	if (!sock || connectionState !== 'open') {
		return {
			connected: false,
			phone: null,
			username: null,
			profilePictureUrl: null,
			businessProfile: null,
			catalog: null
		};
	}

	const jid = getSelfJid();
	const username = String(sock.user?.name || '').trim() || null;
	const phone = extractPhoneFromJid(jid);

	const [profilePictureUrl, businessProfile, catalogResult] = jid
		? await Promise.all([
			withTimeout(sock.profilePictureUrl(jid, 'image').catch(() => null), 5000, null),
			withTimeout(sock.getBusinessProfile(jid).catch(() => null), 5000, null),
			withTimeout(sock.getCatalog({ jid, limit: 10 }).catch(() => ({ products: [] })), 7000, { products: [] })
		])
		: [null, null, { products: [] }];

	return {
		connected: true,
		phone,
		username,
		profilePictureUrl,
		businessProfile: businessProfile
			? {
				description: businessProfile.description || null,
				email: businessProfile.email || null,
				category: businessProfile.category || null,
				address: businessProfile.address || null,
				website: Array.isArray(businessProfile.website) ? businessProfile.website.filter(Boolean) : [],
				businessHours: businessProfile.business_hours || null
			}
			: null,
		catalog: {
			products: Array.isArray(catalogResult?.products)
				? catalogResult.products.map((product) => ({
					id: product.id,
					name: product.name,
					description: product.description || null,
					price: product.price,
					currency: product.currency,
					url: product.url || null,
					availability: product.availability || null,
					imageUrl: product.imageUrls?.requested || product.imageUrls?.original || Object.values(product.imageUrls || {})[0] || null
				}))
				: []
		}
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
		const [profilePictureUrl, status] = await Promise.all([
			sock.profilePictureUrl(jid, 'image').catch(() => null),
			sock.fetchStatus(jid).catch(() => null)
		]);
		return { profilePictureUrl, about: status?.status || null };
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
	getWhatsAppProfile,
	disconnectWhatsApp,
	getContactProfile,
	bindWhatsAppOwner,
	normalizePhone
};
