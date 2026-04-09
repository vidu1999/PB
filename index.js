const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const FIREBASE_URL = process.env.FIREBASE_URL;

const BUSINESS_NAME = "JavaGoat";
const BUSINESS_TAGLINE = "🍔 Fresh burgers, pizzas & more — hot delivered to your door!";
const BUSINESS_WEBSITE = "https://www.javagoat.com";
const BUSINESS_PHONE = "+911234567890";
const PROFILE_PHOTO_URL = ""; // Leave empty or put a public URL

const BUSINESS_ABOUT = `📖 *About ${BUSINESS_NAME}*\nWe serve fresh food daily!`;
const BUSINESS_CONTACT = `📞 *Contact ${BUSINESS_NAME}*\n📱 ${BUSINESS_PHONE}\n🌐 ${BUSINESS_WEBSITE}`;

const orderStates = {};
const userCooldowns = {};
const COOLDOWN_MS = 1500;

function isRateLimited(sender) {
    const now = Date.now();
    const last = userCooldowns[sender] || 0;
    if (now - last < COOLDOWN_MS) return true;
    userCooldowns[sender] = now;
    return false;
}

let menuCache = [];
let menuCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function getMenuFromApp() {
    const now = Date.now();
    if (menuCache.length && now - menuCacheTime < CACHE_TTL) return menuCache;
    try {
        const res = await fetch(`${FIREBASE_URL}/dishes.json`);
        if (res.status === 429) { console.warn("Firebase 429, using cache"); return menuCache; }
        const data = await res.json();
        menuCache = Object.keys(data || {}).map(key => ({
            id: key,
            name: data[key].name,
            price: data[key].price,
            imageUrl: data[key].imageUrl
        }));
        menuCacheTime = now;
        return menuCache;
    } catch (e) {
        console.error("Menu fetch failed:", e.message);
        return menuCache;
    }
}

async function postToFirebase(url, data, retries = 3) {
    for (let i = 1; i <= retries; i++) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (res.status === 429) {
                await new Promise(r => setTimeout(r, i * 2000));
                continue;
            }
            return res;
        } catch (err) {
            console.error(`Firebase attempt ${i} failed:`, err.message);
            if (i === retries) throw err;
        }
    }
}

async function safeSendImage(sock, sender, imageUrl, caption) {
    if (!imageUrl) return sock.sendMessage(sender, { text: caption });
    try {
        const check = await fetch(imageUrl, { method: 'HEAD' });
        if (!check.ok) return sock.sendMessage(sender, { text: caption });
        await sock.sendMessage(sender, { image: { url: imageUrl }, caption });
    } catch {
        await sock.sendMessage(sender, { text: caption });
    }
}

async function sendMainMenu(sock, sender) {
    const welcomeText = `👋 Welcome to ${BUSINESS_NAME}!\n${BUSINESS_TAGLINE}\n\nSelect an option below:`;
    await safeSendImage(sock, sender, PROFILE_PHOTO_URL, welcomeText);
    await sock.sendMessage(sender, {
        text: "Choose an option:",
        buttons: [
            { buttonId: 'menu_0', buttonText: { displayText: '📋 View Menu' }, type: 1 },
            { buttonId: 'about', buttonText: { displayText: '📖 About Us' }, type: 1 },
            { buttonId: 'contact', buttonText: { displayText: '📬 Contact Info' }, type: 1 }
        ],
        headerType: 1
    });
}

async function sendMenuButtons(sock, sender, page = 0) {
    const menu = await getMenuFromApp();
    if (!menu.length) return sock.sendMessage(sender, { text: "⏳ Menu updating, check back later!" });

    const chunk = menu.slice(page * 3, page * 3 + 3);
    const buttons = chunk.map(item => ({
        buttonId: `order_${item.name.replace(/\s+/g, '_')}`,
        buttonText: { displayText: `${item.name} — ₹${item.price}` },
        type: 1
    }));

    if (page > 0) buttons.push({ buttonId: `prev_${page - 1}`, buttonText: { displayText: '⬅️ Previous' }, type: 1 });
    if ((page + 1) * 3 < menu.length) buttons.push({ buttonId: `next_${page + 1}`, buttonText: { displayText: 'Next ➡️' }, type: 1 });

    await sock.sendMessage(sender, {
        text: `🍔 Menu (Page ${page + 1}):`,
        buttons,
        headerType: 1
    });
}

// ───────── MAIN BOT ─────────
async function startBot() {
    if (!FIREBASE_URL) { console.log("FIREBASE_URL missing!"); process.exit(1); }

    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["JavaGoat", "Bot", "1.0"]
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) { console.clear(); qrcode.generate(qr, { small: true }); }
        if (connection === 'open') console.log('✅ JAVAGOAT AI IS ONLINE!');
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg?.message || msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) return;
            const sender = msg.key.remoteJid;
            if (isRateLimited(sender)) return;

            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();
            const buttonReply = msg.message?.buttonsResponseMessage?.selectedButtonId;

            if (buttonReply) {
                // Pagination buttons
                if (buttonReply.startsWith('next_')) return sendMenuButtons(sock, sender, parseInt(buttonReply.split('_')[1]));
                if (buttonReply.startsWith('prev_')) return sendMenuButtons(sock, sender, parseInt(buttonReply.split('_')[1]));

                // Order buttons
                if (buttonReply.startsWith('order_')) {
                    const productRequested = buttonReply.replace('order_', '').replace(/_/g, ' ').toLowerCase();
                    const menu = await getMenuFromApp();
                    const matchedItem = menu.find(i => i.name.toLowerCase() === productRequested);
                    if (!matchedItem) return sock.sendMessage(sender, { text: `❌ Dish not found.` });

                    orderStates[sender] = { step: 'WAITING_FOR_ADDRESS', item: matchedItem };
                    const caption = `🛒 *Order Started!*\nYou selected: *${matchedItem.name}* (₹${matchedItem.price})\n🚚 Delivery ₹50\n💰 Total ₹${parseFloat(matchedItem.price) + 50}\n📍 Reply with: Name, Phone & Address`;
                    return safeSendImage(sock, sender, matchedItem.imageUrl, caption);
                }

                // Main menu buttons
                if (buttonReply === 'menu_0') return sendMenuButtons(sock, sender, 0);
                if (buttonReply === 'about') return sock.sendMessage(sender, { text: BUSINESS_ABOUT });
                if (buttonReply === 'contact') return sock.sendMessage(sender, { text: BUSINESS_CONTACT });
            }

            // Step 2: Address received
            if (orderStates[sender]?.step === 'WAITING_FOR_ADDRESS') {
                const item = orderStates[sender].item;
                const customerWaNumber = sender.split('@')[0];
                const javaGoatOrder = {
                    userId: "whatsapp_" + customerWaNumber,
                    phone: customerWaNumber,
                    address: text,
                    items: [{ id: item.id, name: item.name, price: parseFloat(item.price), quantity: 1 }],
                    total: (parseFloat(item.price) + 50).toFixed(2),
                    status: "Placed",
                    method: "Cash on Delivery (WhatsApp)",
                    timestamp: new Date().toISOString()
                };
                await postToFirebase(`${FIREBASE_URL}/orders.json`, javaGoatOrder);
                await sock.sendMessage(sender, { text: `✅ Order Placed!\nDish: ${item.name}\nTotal: ₹${javaGoatOrder.total}\nPayment: Cash on Delivery\nSay *hi* to order again.` });
                delete orderStates[sender];
                return;
            }

            // Fallback: Greetings
            if (["hi","hello","hey","start"].some(g => text.includes(g))) return sendMainMenu(sock, sender);

        } catch (err) {
            console.error("Handler error:", err.message);
        }
    });
}

process.on('unhandledRejection', r => console.error('Unhandled:', r?.message));
process.on('uncaughtException', e => console.error('Uncaught:', e.message));

startBot().catch(err => console.log("Startup Error: " + err));
