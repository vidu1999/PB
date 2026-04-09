const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino   = require('pino');

const FIREBASE_URL = process.env.FIREBASE_URL;

// ============================================================
// 🖼️ BUSINESS INFO — EDIT THESE
// ============================================================
const BUSINESS_NAME    = "JavaGoat";
const BUSINESS_TAGLINE = "🍔 Fresh burgers, pizzas & more — hot delivered to your door!";
const BUSINESS_WEBSITE = "https://www.javagoat.com";
const BUSINESS_PHONE   = "+911234567890";

const PROFILE_PHOTO_URL = ""; // Put direct image URL here, leave empty "" to skip

const BUSINESS_ABOUT =
    `📖 *About ${BUSINESS_NAME}*\n\n` +
    `We are a modern cloud kitchen serving the *freshest* food in town.\n\n` +
    `🏆 *Why Choose Us?*\n` +
    `✅ Fresh ingredients daily\n` +
    `✅ Fast delivery in 30 mins\n` +
    `✅ 100% Hygienic kitchen\n` +
    `✅ Affordable prices\n\n` +
    `Started in 2023, served *10,000+ happy customers!* 🎉`;

const BUSINESS_CONTACT =
    `📞 *Contact ${BUSINESS_NAME}*\n\n` +
    `📱 *Phone:*   ${BUSINESS_PHONE}\n` +
    `📧 *Email:*   support@javagoat.com\n` +
    `🌐 *Website:* ${BUSINESS_WEBSITE}\n` +
    `📍 *Address:* 123, Food Street, Mumbai, India\n\n` +
    `🕘 *Working Hours:* 9 AM – 10 PM (All Days)\n\n` +
    `💬 We reply within *10 minutes!*`;

const BUSINESS_PROJECTS =
    `🚀 *Our Projects & Platforms*\n\n` +
    `🛒 *JavaGoat App*\n` +
    `   🔗 https://javagoat.com/app\n\n` +
    `🌐 *JavaGoat Website*\n` +
    `   🔗 ${BUSINESS_WEBSITE}\n\n` +
    `🤖 *WhatsApp AI Bot*\n` +
    `   🔗 You're using it right now!\n\n` +
    `📊 *Admin Dashboard*\n` +
    `   🔗 https://admin.javagoat.com`;

// ============================================================

const orderStates = {};

// ─────────────────────────────────────────────────────────────
// ✅ Rate Limiter
// ─────────────────────────────────────────────────────────────
const userCooldowns = {};
const COOLDOWN_MS   = 1500;
function isRateLimited(sender) {
    const now  = Date.now();
    const last = userCooldowns[sender] || 0;
    if (now - last < COOLDOWN_MS) return true;
    userCooldowns[sender] = now;
    return false;
}

// ─────────────────────────────────────────────────────────────
// ✅ Menu Cache
// ─────────────────────────────────────────────────────────────
let menuCache     = [];
let menuCacheTime = 0;
const CACHE_TTL   = 5 * 60 * 1000;

async function getMenuFromApp() {
    const now = Date.now();
    if (menuCache.length > 0 && now - menuCacheTime < CACHE_TTL) return menuCache;
    try {
        const res = await fetch(`${FIREBASE_URL}/dishes.json`);
        if (res.status === 429) { console.warn("⚠️ Firebase 429, using cache"); return menuCache; }
        const data = await res.json();
        if (!data) return [];
        menuCache = Object.keys(data).map(key => ({
            id:       key,
            name:     data[key].name,
            price:    data[key].price,
            imageUrl: data[key].imageUrl
        }));
        menuCacheTime = now;
        return menuCache;
    } catch (e) {
        console.error("❌ Menu fetch failed:", e.message);
        return menuCache;
    }
}

// ─────────────────────────────────────────────────────────────
// ✅ Firebase POST with Retry
// ─────────────────────────────────────────────────────────────
async function postToFirebase(url, data, retries = 3) {
    for (let i = 1; i <= retries; i++) {
        try {
            const res = await fetch(url, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(data)
            });
            if (res.status === 429) {
                const wait = i * 2000;
                console.warn(`⚠️ Firebase 429, retry ${i} in ${wait}ms`);
                await new Promise(r => setTimeout(r, wait));
                continue;
            }
            return res;
        } catch (err) {
            console.error(`❌ Firebase attempt ${i} failed:`, err.message);
            if (i === retries) throw err;
        }
    }
}

// ─────────────────────────────────────────────────────────────
// ✅ Safe Image Sender — NEVER crashes on 403/404
// ─────────────────────────────────────────────────────────────
async function safeSendImage(sock, sender, imageUrl, caption) {
    if (!imageUrl || imageUrl.trim() === "") {
        await sock.sendMessage(sender, { text: caption });
        return;
    }
    try {
        const check = await fetch(imageUrl, { method: 'HEAD' });
        if (!check.ok) {
            console.warn(`⚠️ Image URL returned ${check.status}, sending text only`);
            await sock.sendMessage(sender, { text: caption });
            return;
        }
        await sock.sendMessage(sender, {
            image:   { url: imageUrl },
            caption: caption
        });
    } catch (imgErr) {
        console.warn("⚠️ Image send failed, using text fallback:", imgErr.message);
        await sock.sendMessage(sender, { text: caption });
    }
}

// ─────────────────────────────────────────────────────────────
// 🌟 Send Main Menu with Buttons
// ─────────────────────────────────────────────────────────────
async function sendMainMenu(sock, sender) {
    const welcomeText =
        `👋 *Welcome to ${BUSINESS_NAME}!*\n\n` +
        `${BUSINESS_TAGLINE}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🌐 ${BUSINESS_WEBSITE}\n` +
        `📱 ${BUSINESS_PHONE}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👇 *Tap a button below!*`;

    await safeSendImage(sock, sender, PROFILE_PHOTO_URL, welcomeText);

    const buttons = [
        { buttonId: 'menu', buttonText: { displayText: '📋 View Menu' }, type: 1 },
        { buttonId: 'about', buttonText: { displayText: '📖 About Us' }, type: 1 },
        { buttonId: 'contact', buttonText: { displayText: '📬 Contact Info' }, type: 1 },
        { buttonId: 'projects', buttonText: { displayText: '🚀 Our Projects' }, type: 1 },
        { buttonId: 'howtoorder', buttonText: { displayText: '🛒 How to Order' }, type: 1 }
    ];

    await sock.sendMessage(sender, {
        text: "Choose an option below:",
        buttons,
        headerType: 1
    });
}

// ─────────────────────────────────────────────────────────────
// 📋 Send Menu with Buttons
// ─────────────────────────────────────────────────────────────
async function sendMenuButtons(sock, sender) {
    const menu = await getMenuFromApp();

    if (menu.length === 0) {
        await sock.sendMessage(sender, { text: "⏳ Menu is updating. Please check back in a few minutes!" });
        return;
    }

    const menuText = menu.map((item, i) => `${i + 1}. 🔸 *${item.name}* — ₹${item.price}`).join('\n');
    await sock.sendMessage(sender, { text: `🍔 *JAVAGOAT LIVE MENU* 🍕\n\n${menuText}` });

    // Buttons for first 10 menu items (max buttons allowed)
    const buttons = menu.slice(0, 10).map(item => ({
        buttonId: `order_${item.name.replace(/\s+/g, '_')}`,
        buttonText: { displayText: `${item.name} — ₹${item.price}` },
        type: 1
    }));

    await sock.sendMessage(sender, {
        text: "Select a dish to order:",
        buttons,
        headerType: 1
    });
}

// ─────────────────────────────────────────────────────────────
// 🤖 MAIN BOT
// ─────────────────────────────────────────────────────────────
async function startBot() {
    if (!FIREBASE_URL) {
        console.log("❌ ERROR: FIREBASE_URL missing!");
        process.exit(1);
    }

    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version }          = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["S", "K", "1"]
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.clear();
            console.log('Scan QR to login:');
            qrcode.generate(qr, { small: true });
        }
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

            const text = (
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                ""
            ).toLowerCase().trim();

            console.log(`📩 From ${sender.split('@')[0]}: "${text || '[button]'}"`);

            // ── BUTTON HANDLER ─────────────────────────────
            const buttonReply = msg.message?.buttonsResponseMessage?.selectedButtonId;

            if (buttonReply) {
                if (buttonReply === 'menu') return await sendMenuButtons(sock, sender);
                if (buttonReply === 'about') return await sock.sendMessage(sender, { text: BUSINESS_ABOUT });
                if (buttonReply === 'contact') return await sock.sendMessage(sender, { text: BUSINESS_CONTACT });
                if (buttonReply === 'projects') return await sock.sendMessage(sender, { text: BUSINESS_PROJECTS });
                if (buttonReply === 'howtoorder') {
                    return await sock.sendMessage(sender, {
                        text:
                            `🛒 *How to Order:*\n\n` +
                            `1️⃣ Type *menu* → tap a dish button\n` +
                            `2️⃣ Send your *Name + Address*\n` +
                            `3️⃣ Order confirmed! 🎉\n\n` +
                            `Or directly type: *order pizza*`
                    });
                }

                // Dish order buttons
                if (buttonReply.startsWith('order_')) {
                    const productRequested = buttonReply.replace('order_', '').replace(/_/g, ' ').toLowerCase();
                    const menu = await getMenuFromApp();
                    const matchedItem = menu.find(i => i.name.toLowerCase() === productRequested);

                    if (!matchedItem) return await sock.sendMessage(sender, { text: `❌ Dish not found.` });

                    orderStates[sender] = { step: 'WAITING_FOR_ADDRESS', item: matchedItem };

                    const captionText =
                        `🛒 *Order Started!*\n\n` +
                        `You selected: *${matchedItem.name}* (₹${matchedItem.price})\n` +
                        `🚚 *Delivery Fee:* ₹50\n` +
                        `💰 *Total:* ₹${parseFloat(matchedItem.price) + 50}\n\n` +
                        `📍 Please reply with:\n*Full Name, Phone & Delivery Address*`;

                    return await safeSendImage(sock, sender, matchedItem.imageUrl, captionText);
                }
            }

            // ── ORDER STEP 2 — Address received
            if (orderStates[sender]?.step === 'WAITING_FOR_ADDRESS') {
                const item = orderStates[sender].item;
                const customerWaNumber = sender.split('@')[0];

                const javaGoatOrder = {
                    userId:    "whatsapp_" + customerWaNumber,
                    userEmail: "whatsapp@javagoat.com",
                    phone:     customerWaNumber,
                    address:   text,
                    location:  { lat: 0, lng: 0 },
                    items: [{ id: item.id, name: item.name, price: parseFloat(item.price), img: item.imageUrl || "", quantity: 1 }],
                    total: (parseFloat(item.price) + 50).toFixed(2),
                    status: "Placed",
                    method: "Cash on Delivery (WhatsApp)",
                    timestamp: new Date().toISOString()
                };

                await postToFirebase(`${FIREBASE_URL}/orders.json`, javaGoatOrder);

                await sock.sendMessage(sender, {
                    text:
                        `✅ *Order Placed Successfully!*\n\n` +
                        `Your *${item.name}* is being prepared! 👨‍🍳\n\n` +
                        `*Total:* ₹${javaGoatOrder.total} (Inc. ₹50 Delivery)\n` +
                        `*Payment:* Cash on Delivery\n` +
                        `*Status:* 🟡 Preparing\n\n` +
                        `Delivering to your address soon! 🚀\n\n` +
                        `Say *hi* to place another order 😊`
                });
                delete orderStates[sender];
                return;
            }

            // ── TEXT HANDLERS
            if (["hi","hello","hey","start"].some(g => text.includes(g))) return await sendMainMenu(sock, sender);
            if (text === "menu") return await sendMenuButtons(sock, sender);
            if (["about"].includes(text)) return await sock.sendMessage(sender, { text: BUSINESS_ABOUT });
            if (["contact"].includes(text)) return await sock.sendMessage(sender, { text: BUSINESS_CONTACT });
            if (["projects"].includes(text)) return await sock.sendMessage(sender, { text: BUSINESS_PROJECTS });

            if (text.startsWith("order ")) {
                const productRequested = text.replace("order ", "").trim().toLowerCase();
                const menu = await getMenuFromApp();
                const matchedItem = menu.find(i => i.name.toLowerCase() === productRequested);
                if (!matchedItem) return await sock.sendMessage(sender, { text: `❌ Dish not found.` });

                orderStates[sender] = { step: 'WAITING_FOR_ADDRESS', item: matchedItem };
                const captionText =
                    `🛒 *Order Started!*\n\n` +
                    `You selected: *${matchedItem.name}* (₹${matchedItem.price})\n` +
                    `🚚 *Delivery Fee:* ₹50\n` +
                    `💰 *Total:* ₹${parseFloat(matchedItem.price) + 50}\n\n` +
                    `📍 Please reply with:\n*Full Name, Phone & Delivery Address*`;

                return await safeSendImage(sock, sender, matchedItem.imageUrl, captionText);
            }

            // 🤔 Fallback
            await sock.sendMessage(sender, {
                text:
                    `🤔 I didn't understand that.\n\n` +
                    `👋 *hi* → Main Menu\n` +
                    `📋 *menu* → Food Menu\n` +
                    `📖 *about* → About Us\n` +
                    `📬 *contact* → Contact Info\n` +
                    `🚀 *projects* → Our Projects\n` +
                    `🛒 *order [food]* → Place Order\n\n` +
                    `_Say *hi* to get started!_ 😊`
            });

        } catch (err) {
            console.error("❌ Handler error:", err.message);
        }
    });
}

// Global crash protection
process.on('unhandledRejection', (r) => console.error('⚠️ Unhandled:', r?.message || r));
process.on('uncaughtException',  (e) => console.error('⚠️ Uncaught:', e.message));

startBot().catch(err => console.log("❌ Startup Error: " + err));
