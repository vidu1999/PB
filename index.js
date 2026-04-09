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
// 🖼️ BUSINESS INFO
// ============================================================
const BUSINESS_NAME    = "JavaGoat";
const BUSINESS_TAGLINE = "🍔 Fresh burgers, pizzas & more — hot delivered to your door!";
const BUSINESS_WEBSITE = "https://www.javagoat.com";
const BUSINESS_PHONE   = "+911234567890";

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
// ✅ Menu Cache (prevents Firebase 429)
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
        menuCache     = Object.keys(data).map(key => ({
            id: key, name: data[key].name, price: data[key].price, imageUrl: data[key].imageUrl
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
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (res.status === 429) {
                const wait = i * 2000;
                console.warn(`⚠️ Firebase 429, retry ${i} in ${wait}ms`);
                await new Promise(r => setTimeout(r, wait));
                continue;
            }
            return res;
        } catch (err) {
            if (i === retries) throw err;
        }
    }
}

// ─────────────────────────────────────────────────────────────
// 🌟 THE BEST BUTTON REPLACEMENT → sendPoll
// Users tap an option = bot reads it like a button tap!
// ─────────────────────────────────────────────────────────────
async function sendMainMenu(sock, sender) {
    // Step 1: Send welcome image + info text
    await sock.sendMessage(sender, {
        image: { url: "https://your-image-url.com/javagoat-logo.jpg" },
        caption:
            `👋 *Welcome to ${BUSINESS_NAME}!*\n\n` +
            `${BUSINESS_TAGLINE}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🌐 ${BUSINESS_WEBSITE}\n` +
            `📱 ${BUSINESS_PHONE}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `👇 *Tap an option in the poll below!*`
    });

    // Step 2: Send Poll — works like clickable buttons! ✅
    await sock.sendMessage(sender, {
        poll: {
            name: `🍽️ What do you want to do?`,   // Poll question
            values: [                                // Poll options (act as buttons)
                "📋 View Menu",
                "📖 About Us",
                "📬 Contact Info",
                "🚀 Our Projects",
                "🛒 How to Order"
            ],
            selectableCount: 1   // Single choice only (like a button)
        }
    });
}

// ─────────────────────────────────────────────────────────────
// 📋 Send Menu as Poll (user taps dish to order!)
// ─────────────────────────────────────────────────────────────
async function sendMenuPoll(sock, sender) {
    const menu = await getMenuFromApp();

    if (menu.length === 0) {
        await sock.sendMessage(sender, { text: "⏳ Menu is updating. Please check back soon!" });
        return;
    }

    // Show full menu text first
    let menuText = `🍔 *JAVAGOAT LIVE MENU* 🍕\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    menu.forEach((item, i) => {
        menuText += `${i + 1}. 🔸 *${item.name}* — ₹${item.price}\n`;
    });
    menuText += `\n━━━━━━━━━━━━━━━━━━━━\n👇 *Tap a dish in the poll to order it!*`;

    await sock.sendMessage(sender, { text: menuText });

    // Send menu as a poll — tap = order that item!
    // WhatsApp polls support max 12 options
    const pollOptions = menu.slice(0, 12).map(item => `${item.name} — ₹${item.price}`);

    await sock.sendMessage(sender, {
        poll: {
            name: "🛒 Which dish do you want to order?",
            values: pollOptions,
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
            console.log('⚠️ QR CODE TOO BIG? CLICK "View raw logs" top right!');
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

    // ── Message Handler ──────────────────────────────────────
    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
            if (msg.key.fromMe) return;

            const sender = msg.key.remoteJid;
            if (isRateLimited(sender)) return;

            // ✅ Read poll vote (user tapped a poll option)
            const pollVote = msg.message?.pollUpdateMessage;

            // ✅ Read normal text messages
            const text = (
                msg.message.conversation                                           ||
                msg.message.extendedTextMessage?.text                             ||
                ""
            ).toLowerCase().trim();

            console.log(`📩 From ${sender.split('@')[0]}: "${text || '[poll vote]'}"`);

            // ══════════════════════════════════════════════
            // 🗳️ HANDLE POLL VOTES (main menu + menu poll)
            // ══════════════════════════════════════════════
            if (pollVote) {
                // Get the selected option name from the vote
                const selectedOption = pollVote.vote?.selectedOptions?.[0]?.optionName || "";
                const voteLower      = selectedOption.toLowerCase();

                console.log(`🗳️ Poll vote: "${selectedOption}"`);

                // ── Main Menu Poll Options ─────────────────
                if (voteLower.includes("view menu") || voteLower.includes("menu")) {
                    await sendMenuPoll(sock, sender);
                    return;
                }
                if (voteLower.includes("about")) {
                    await sock.sendMessage(sender, { text: BUSINESS_ABOUT });
                    await sock.sendMessage(sender, { text: `💡 Say *hi* to return to the main menu!` });
                    return;
                }
                if (voteLower.includes("contact")) {
                    await sock.sendMessage(sender, { text: BUSINESS_CONTACT });
                    return;
                }
                if (voteLower.includes("projects")) {
                    await sock.sendMessage(sender, { text: BUSINESS_PROJECTS });
                    return;
                }
                if (voteLower.includes("how to order")) {
                    await sock.sendMessage(sender, {
                        text:
                            `🛒 *How to Order:*\n\n` +
                            `1️⃣ Type *menu* to see all dishes\n` +
                            `2️⃣ Tap a dish in the poll\n` +
                            `3️⃣ Send your *Name + Address*\n` +
                            `4️⃣ Order placed! 🎉\n\n` +
                            `Or just type: *order pizza*, *order burger* etc.`
                    });
                    return;
                }

                // ── Menu Poll — User tapped a dish to order ─
                const menu = await getMenuFromApp();
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
                        `📍 Please reply with your:\n*Full Name, Phone & Delivery Address*`;

                    if (matchedItem.imageUrl) {
                        await sock.sendMessage(sender, {
                            image:   { url: matchedItem.imageUrl },
                            caption: orderText
                        });
                    } else {
                        await sock.sendMessage(sender, { text: orderText });
                    }
                    return;
                }

                // Unknown poll vote fallback
                await sock.sendMessage(sender, {
                    text: `🤔 Didn't catch that. Say *hi* to see the menu again!`
                });
                return;
            }

            // ══════════════════════════════════════════════
            // 🛒 ORDER STEP 2: Waiting for Address
            // ══════════════════════════════════════════════
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
                        `Your order for *${item.name}* is being prepared! 👨‍🍳\n\n` +
                        `*Total:* ₹${javaGoatOrder.total} (Inc. ₹50 Delivery)\n` +
                        `*Payment:* Cash on Delivery\n` +
                        `*Status:* 🟡 Preparing\n\n` +
                        `Delivering to your address soon! 🚀\n\n` +
                        `Say *hi* to order again! 😊`
                });
                delete orderStates[sender];
                return;
            }

            // ══════════════════════════════════════════════
            // 📝 TEXT KEYWORD HANDLERS
            // ══════════════════════════════════════════════

            // 👋 Greeting → Show main poll menu
            if (["hi","hello","hey","start","hii","helo"].some(g => text.includes(g))) {
                await sendMainMenu(sock, sender);
                return;
            }

            // 📋 Menu keyword
            if (text === "menu" || text.includes("food") || text.includes("price") || text.includes("list")) {
                await sendMenuPoll(sock, sender);
                return;
            }

            // 📖 About
            if (text === "about" || text === "about me" || text === "aboutme") {
                await sock.sendMessage(sender, { text: BUSINESS_ABOUT });
                return;
            }

            // 📬 Contact
            if (text === "contact" || text.includes("call") || text === "contactme") {
                await sock.sendMessage(sender, { text: BUSINESS_CONTACT });
                return;
            }

            // 🚀 Projects
            if (text === "projects" || text === "project" || text === "portfolio") {
                await sock.sendMessage(sender, { text: BUSINESS_PROJECTS });
                return;
            }

            // 🛒 Direct order by text: "order pizza"
            if (text.startsWith("order ")) {
                const productRequested = text.replace("order ", "").trim();
                const menu             = await getMenuFromApp();
                const matchedItem      = menu.find(i => i.name.toLowerCase().includes(productRequested));

                if (!matchedItem) {
                    await sock.sendMessage(sender, {
                        text: `❌ *${productRequested}* not found in menu.\n\nType *menu* to see all dishes!`
                    });
                    return;
                }

                orderStates[sender] = { step: 'WAITING_FOR_ADDRESS', item: matchedItem };

                const captionText =
                    `🛒 *Order Started!*\n\n` +
                    `You selected: *${matchedItem.name}* (₹${matchedItem.price})\n` +
                    `🚚 *Delivery Fee:* ₹50\n` +
                    `💰 *Total:* ₹${parseFloat(matchedItem.price) + 50}\n\n` +
                    `📍 Please reply with your:\n*Full Name, Phone & Delivery Address*`;

                if (matchedItem.imageUrl) {
                    await sock.sendMessage(sender, { image: { url: matchedItem.imageUrl }, caption: captionText });
                } else {
                    await sock.sendMessage(sender, { text: captionText });
                }
                return;
            }

            // 🛒 "order" alone
            if (text === "order") {
                await sock.sendMessage(sender, {
                    text: `🛒 *How to Order:*\n\nType: *order [dish name]*\n\nExample: *order pizza*\n\nOr type *menu* to see all dishes first! 📋`
                });
                return;
            }

            // 🤔 Default fallback
            await sock.sendMessage(sender, {
                text:
                    `🤔 I didn't understand that.\n\n` +
                    `Here's what I can do:\n\n` +
                    `👋 *hi*              → Main Menu (Poll)\n` +
                    `📋 *menu*            → Food Menu (Poll)\n` +
                    `📖 *about*           → About JavaGoat\n` +
                    `📬 *contact*         → Contact Info\n` +
                    `🚀 *projects*        → Our Projects\n` +
                    `🛒 *order [food]*    → Place an Order\n\n` +
                    `_Say *hi* to see the full menu!_ 😊`
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
