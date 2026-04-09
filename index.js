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

// ✅ FIX: Use a direct public image URL (no redirects, no auth)
// ✅ Best free hosts: imgur.com, imgbb.com, postimages.org
// ✅ Example imgbb direct link format:
//    https://i.ibb.co/XXXXXXX/your-logo.jpg
// ✅ Leave empty string "" to skip image entirely (no crash)
const PROFILE_PHOTO_URL = ""; // 🔁 PUT YOUR IMAGE URL HERE or leave "" to skip

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
// ✅ FIX: Safe Image Sender — NEVER crashes on 403/404
// Tries image first → falls back to text only if image fails
// ─────────────────────────────────────────────────────────────
async function safeSendImage(sock, sender, imageUrl, caption) {
    // If no URL provided, just send text directly
    if (!imageUrl || imageUrl.trim() === "") {
        await sock.sendMessage(sender, { text: caption });
        return;
    }

    try {
        // ✅ First check if URL is reachable (HEAD request, no download)
        const check = await fetch(imageUrl, { method: 'HEAD' });
        if (!check.ok) {
            // URL returned 403/404 etc — skip image, send text only
            console.warn(`⚠️ Image URL returned ${check.status}, sending text only`);
            await sock.sendMessage(sender, { text: caption });
            return;
        }

        // URL is valid — send with image
        await sock.sendMessage(sender, {
            image:   { url: imageUrl },
            caption: caption
        });

    } catch (imgErr) {
        // Any network error — skip image, send text only
        console.warn("⚠️ Image send failed, using text fallback:", imgErr.message);
        await sock.sendMessage(sender, { text: caption });
    }
}

// ─────────────────────────────────────────────────────────────
// 🌟 Send Main Menu Poll
// ─────────────────────────────────────────────────────────────
async function sendMainMenu(sock, sender) {
    const welcomeText =
        `👋 *Welcome to ${BUSINESS_NAME}!*\n\n` +
        `${BUSINESS_TAGLINE}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🌐 ${BUSINESS_WEBSITE}\n` +
        `📱 ${BUSINESS_PHONE}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👇 *Tap an option in the poll below!*`;

    // ✅ Safe image send — will fallback to text if image fails
    await safeSendImage(sock, sender, PROFILE_PHOTO_URL, welcomeText);

    // ✅ Poll always sends regardless of image success/fail
    await sock.sendMessage(sender, {
        poll: {
            name:            `🍽️ What do you want to do?`,
            values:          [
                "📋 View Menu",
                "📖 About Us",
                "📬 Contact Info",
                "🚀 Our Projects",
                "🛒 How to Order"
            ],
            selectableCount: 1
        }
    });
}

// ─────────────────────────────────────────────────────────────
// 📋 Send Menu Poll
// ─────────────────────────────────────────────────────────────
async function sendMenuPoll(sock, sender) {
    const menu = await getMenuFromApp();

    if (menu.length === 0) {
        await sock.sendMessage(sender, {
            text: "⏳ Menu is updating. Please check back in a few minutes!"
        });
        return;
    }

    let menuText = `🍔 *JAVAGOAT LIVE MENU* 🍕\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    menu.forEach((item, i) => {
        menuText += `${i + 1}. 🔸 *${item.name}* — ₹${item.price}\n`;
    });
    menuText += `\n━━━━━━━━━━━━━━━━━━━━\n👇 *Tap a dish in the poll to order it!*`;

    await sock.sendMessage(sender, { text: menuText });

    // Max 12 options in WhatsApp poll
    const pollOptions = menu.slice(0, 12).map(item => `${item.name} — ₹${item.price}`);

    await sock.sendMessage(sender, {
        poll: {
            name:            "🛒 Which dish do you want to order?",
            values:          pollOptions,
            selectableCount: 1
        }
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
        auth:              state,
        printQRInTerminal: false,
        logger:            pino({ level: 'silent' }),
        browser:           ["S", "K", "1"]
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.clear();
            console.log('\n==================================================');
            console.log('⚠️ QR TOO BIG? CLICK "View raw logs" top right!');
            console.log('==================================================\n');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'open')  console.log('✅ JAVAGOAT AI IS ONLINE!');
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // ────────────────────────────────────────────────────────
    // 📨 Message Handler
    // ────────────────────────────────────────────────────────
    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg?.message)                                    return;
            if (msg.key.remoteJid === 'status@broadcast')         return;
            if (msg.key.fromMe)                                   return;

            const sender = msg.key.remoteJid;
            if (isRateLimited(sender))                            return;

            // ── Read poll vote ──────────────────────────────
            const pollVote = msg.message?.pollUpdateMessage;

            // ── Read text ───────────────────────────────────
            const text = (
                msg.message.conversation              ||
                msg.message.extendedTextMessage?.text ||
                ""
            ).toLowerCase().trim();

            console.log(`📩 From ${sender.split('@')[0]}: "${text || '[poll]'}"`);

            // ════════════════════════════════════════════════
            // 🗳️ POLL VOTE HANDLER
            // ════════════════════════════════════════════════
            if (pollVote) {
                const selectedOption = pollVote.vote?.selectedOptions?.[0]?.optionName || "";
                const v              = selectedOption.toLowerCase();
                console.log(`🗳️ Poll vote: "${selectedOption}"`);

                if (v.includes("view menu") || v.includes("menu")) {
                    await sendMenuPoll(sock, sender);
                    return;
                }
                if (v.includes("about")) {
                    await sock.sendMessage(sender, { text: BUSINESS_ABOUT });
                    await sock.sendMessage(sender, { text: `💡 Say *hi* to return to main menu!` });
                    return;
                }
                if (v.includes("contact")) {
                    await sock.sendMessage(sender, { text: BUSINESS_CONTACT });
                    return;
                }
                if (v.includes("projects")) {
                    await sock.sendMessage(sender, { text: BUSINESS_PROJECTS });
                    return;
                }
                if (v.includes("how to order")) {
                    await sock.sendMessage(sender, {
                        text:
                            `🛒 *How to Order:*\n\n` +
                            `1️⃣ Type *menu* → tap a dish in the poll\n` +
                            `2️⃣ Send your *Name + Address*\n` +
                            `3️⃣ Order confirmed! 🎉\n\n` +
                            `Or directly type: *order pizza*`
                    });
                    return;
                }

                // ── Menu poll — user tapped a dish ──────────
                const menu        = await getMenuFromApp();
                const matchedItem = menu.find(item =>
                    selectedOption.toLowerCase().includes(item.name.toLowerCase())
                );

                if (matchedItem) {
                    orderStates[sender] = { step: 'WAITING_FOR_ADDRESS', item: matchedItem };

                    const orderText =
                        `🛒 *Order Started!*\n\n` +
                        `You selected: *${matchedItem.name}* (₹${matchedItem.price})\n` +
                        `🚚 *Delivery Fee:* ₹50\n` +
                        `💰 *Total:* ₹${parseFloat(matchedItem.price) + 50}\n\n` +
                        `📍 Please reply with:\n*Full Name, Phone & Delivery Address*`;

                    // ✅ Safe image send for dish image too
                    await safeSendImage(sock, sender, matchedItem.imageUrl, orderText);
                    return;
                }

                await sock.sendMessage(sender, {
                    text: `🤔 Couldn't process that. Say *hi* to see the main menu!`
                });
                return;
            }

            // ════════════════════════════════════════════════
            // 🛒 ORDER STEP 2 — Address received
            // ════════════════════════════════════════════════
            if (orderStates[sender]?.step === 'WAITING_FOR_ADDRESS') {
                const item             = orderStates[sender].item;
                const customerWaNumber = sender.split('@')[0];

                const javaGoatOrder = {
                    userId:    "whatsapp_" + customerWaNumber,
                    userEmail: "whatsapp@javagoat.com",
                    phone:     customerWaNumber,
                    address:   text,
                    location:  { lat: 0, lng: 0 },
                    items: [{
                        id:       item.id,
                        name:     item.name,
                        price:    parseFloat(item.price),
                        img:      item.imageUrl || "",
                        quantity: 1
                    }],
                    total:     (parseFloat(item.price) + 50).toFixed(2),
                    status:    "Placed",
                    method:    "Cash on Delivery (WhatsApp)",
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

            // ════════════════════════════════════════════════
            // 📝 TEXT KEYWORD HANDLERS
            // ════════════════════════════════════════════════

            if (["hi","hello","hey","start","hii","helo"].some(g => text.includes(g))) {
                await sendMainMenu(sock, sender);
                return;
            }

            if (text === "menu" || text.includes("food") || text.includes("price") || text.includes("list")) {
                await sendMenuPoll(sock, sender);
                return;
            }

            if (["about","about me","aboutme"].includes(text)) {
                await sock.sendMessage(sender, { text: BUSINESS_ABOUT });
                return;
            }

            if (["contact","contactme","call us"].includes(text) || text.includes("call")) {
                await sock.sendMessage(sender, { text: BUSINESS_CONTACT });
                return;
            }

            if (["projects","project","portfolio"].includes(text)) {
                await sock.sendMessage(sender, { text: BUSINESS_PROJECTS });
                return;
            }

            if (text.startsWith("order ")) {
                const productRequested = text.replace("order ", "").trim();
                const menu             = await getMenuFromApp();
                const matchedItem      = menu.find(i => i.name.toLowerCase().includes(productRequested));

                if (!matchedItem) {
                    await sock.sendMessage(sender, {
                        text: `❌ *${productRequested}* not found.\n\nType *menu* to see all dishes!`
                    });
                    return;
                }

                orderStates[sender] = { step: 'WAITING_FOR_ADDRESS', item: matchedItem };

                const captionText =
                    `🛒 *Order Started!*\n\n` +
                    `You selected: *${matchedItem.name}* (₹${matchedItem.price})\n` +
                    `🚚 *Delivery Fee:* ₹50\n` +
                    `💰 *Total:* ₹${parseFloat(matchedItem.price) + 50}\n\n` +
                    `📍 Please reply with:\n*Full Name, Phone & Delivery Address*`;

                await safeSendImage(sock, sender, matchedItem.imageUrl, captionText);
                return;
            }

            if (text === "order") {
                await sock.sendMessage(sender, {
                    text:
                        `🛒 *How to Order:*\n\n` +
                        `Type: *order [dish name]*\n\n` +
                        `Example: *order pizza*\n\n` +
                        `Or type *menu* to browse first! 📋`
                });
                return;
            }

            // 🤔 Fallback
            await sock.sendMessage(sender, {
                text:
                    `🤔 I didn't understand that.\n\n` +
                    `Here's what I can do:\n\n` +
                    `👋 *hi*              → Main Menu\n` +
                    `📋 *menu*            → Food Menu\n` +
                    `📖 *about*           → About Us\n` +
                    `📬 *contact*         → Contact Info\n` +
                    `🚀 *projects*        → Our Projects\n` +
                    `🛒 *order [food]*    → Place Order\n\n` +
                    `_Say *hi* to get started!_ 😊`
            });

        } catch (err) {
            console.error("❌ Handler error (non-fatal):", err.message);
        }
    });
}

// Global crash protection
process.on('unhandledRejection', (r) => console.error('⚠️ Unhandled:', r?.message || r));
process.on('uncaughtException',  (e) => console.error('⚠️ Uncaught:', e.message));

startBot().catch(err => console.log("❌ Startup Error: " + err));
