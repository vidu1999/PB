const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino   = require('pino');

const FIREBASE_URL = process.env.FIREBASE_URL;

// ============================================================
// 🖼️ BUSINESS PROFILE INFO
// ============================================================
const PROFILE_PHOTO_URL = "https://your-image-url.com/javagoat-logo.jpg";
const BUSINESS_NAME     = "JavaGoat";
const BUSINESS_TAGLINE  = "🍔 Fresh burgers, pizzas & more — hot delivered to your door!";
const BUSINESS_ABOUT    =
    `📖 *About ${BUSINESS_NAME}*\n\n` +
    `We are a modern cloud kitchen dedicated to serving the *freshest and tastiest* food in town.\n\n` +
    `🏆 *Why Choose Us?*\n` +
    `✅ Fresh ingredients daily\n` +
    `✅ Fast delivery in 30 mins\n` +
    `✅ 100% Hygienic kitchen\n` +
    `✅ Affordable prices\n\n` +
    `Started in 2023, we have served *10,000+ happy customers!* 🎉`;

const BUSINESS_CONTACT =
    `📞 *Contact ${BUSINESS_NAME}*\n\n` +
    `📱 *Phone:*   +911234567890\n` +
    `📧 *Email:*   support@javagoat.com\n` +
    `🌐 *Website:* https://www.javagoat.com\n` +
    `📍 *Address:* 123, Food Street, Mumbai, India\n\n` +
    `🕘 *Working Hours:* 9 AM – 10 PM (All Days)\n\n` +
    `💬 We reply within *10 minutes!*`;

const BUSINESS_PROJECTS =
    `🚀 *Our Projects & Platforms*\n\n` +
    `🛒 *JavaGoat App*\n` +
    `   Order food from our Android/iOS App\n` +
    `   🔗 https://javagoat.com/app\n\n` +
    `🌐 *JavaGoat Website*\n` +
    `   Browse menu, track orders online\n` +
    `   🔗 https://www.javagoat.com\n\n` +
    `🤖 *WhatsApp AI Bot*\n` +
    `   Order food directly via WhatsApp\n` +
    `   🔗 You're using it right now!\n\n` +
    `📊 *Admin Dashboard*\n` +
    `   Live order management panel\n` +
    `   🔗 https://admin.javagoat.com\n\n` +
    `_More projects coming soon... 🔥_`;

const BUSINESS_WEBSITE = "https://www.javagoat.com";
const BUSINESS_PHONE   = "+911234567890";
// ============================================================

const orderStates = {};

// ─────────────────────────────────────────────────────────────
// ✅ FIX 1 — Per-User Rate Limiter (prevents 429 spam)
// ─────────────────────────────────────────────────────────────
const userCooldowns = {};
const COOLDOWN_MS   = 1500; // 1.5 seconds between messages per user

function isRateLimited(sender) {
    const now  = Date.now();
    const last = userCooldowns[sender] || 0;
    if (now - last < COOLDOWN_MS) return true;
    userCooldowns[sender] = now;
    return false;
}

// ─────────────────────────────────────────────────────────────
// ✅ FIX 2 — Menu Cache (prevents hammering Firebase on every message)
// ─────────────────────────────────────────────────────────────
let menuCache      = [];
let menuCacheTime  = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // Cache menu for 5 minutes

async function getMenuFromApp() {
    const now = Date.now();
    if (menuCache.length > 0 && now - menuCacheTime < CACHE_TTL_MS) {
        return menuCache; // ✅ Return cached version
    }
    try {
        const response = await fetch(`${FIREBASE_URL}/dishes.json`);

        // ✅ FIX 3 — Handle 429 from Firebase explicitly
        if (response.status === 429) {
            console.warn("⚠️ Firebase rate limited (429). Using cached menu.");
            return menuCache; // Return stale cache rather than crashing
        }

        const data = await response.json();
        if (!data) return [];

        menuCache     = Object.keys(data).map(key => ({
            id:       key,
            name:     data[key].name,
            price:    data[key].price,
            imageUrl: data[key].imageUrl
        }));
        menuCacheTime = now;
        return menuCache;

    } catch (error) {
        console.error("❌ Failed to fetch menu:", error.message);
        return menuCache; // Return last known cache on error
    }
}

// ─────────────────────────────────────────────────────────────
// ✅ FIX 4 — Firebase POST with Retry on 429
// ─────────────────────────────────────────────────────────────
async function postToFirebase(url, data, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(data)
            });

            if (res.status === 429) {
                const waitTime = attempt * 2000; // 2s, 4s, 6s backoff
                console.warn(`⚠️ Firebase 429 on attempt ${attempt}. Retrying in ${waitTime}ms...`);
                await new Promise(r => setTimeout(r, waitTime));
                continue;
            }

            return res; // ✅ Success
        } catch (err) {
            console.error(`❌ Firebase POST error (attempt ${attempt}):`, err.message);
            if (attempt === retries) throw err;
        }
    }
}

// ─────────────────────────────────────────────────────────────
// 🚀 Send Profile Card
// ─────────────────────────────────────────────────────────────
async function sendProfileCard(sock, sender) {
    const greetCaption =
        `👋 *Welcome to ${BUSINESS_NAME}!*\n\n` +
        `${BUSINESS_TAGLINE}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🌐 ${BUSINESS_WEBSITE}\n` +
        `📱 ${BUSINESS_PHONE}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👇 *Tap a button below to explore us!*`;

    try {
        await sock.sendMessage(sender, {
            image: { url: PROFILE_PHOTO_URL },
            caption: greetCaption,
            footer: `${BUSINESS_NAME} • AI Assistant 🤖`,
            templateButtons: [
                { index: 1, callButton:      { displayText: '📞 Call Us',       phoneNumber: BUSINESS_PHONE } },
                { index: 2, urlButton:       { displayText: '🌐 Visit Website', url: BUSINESS_WEBSITE } },
                { index: 3, quickReplyButton:{ displayText: '📖 About Me',      id: 'btn_about' } },
                { index: 4, quickReplyButton:{ displayText: '📬 Contact Me',    id: 'btn_contact' } },
                { index: 5, quickReplyButton:{ displayText: '🚀 Projects',      id: 'btn_projects' } }
            ]
        });
    } catch (err) {
        console.warn("⚠️ Template buttons failed, trying list message:", err.message);
        try {
            await sock.sendMessage(sender, {
                image: { url: PROFILE_PHOTO_URL },
                caption: greetCaption
            });
            await sock.sendMessage(sender, {
                listMessage: {
                    title:      `👋 Welcome to ${BUSINESS_NAME}!`,
                    text:       `Explore us using the options below 👇`,
                    footer:     `${BUSINESS_NAME} AI Assistant 🤖`,
                    buttonText: `📋 EXPLORE OPTIONS`,
                    sections: [
                        {
                            title: "🌟 Quick Actions",
                            rows: [
                                { id: "btn_about",    title: "📖 About Me",     description: "Learn about JavaGoat" },
                                { id: "btn_contact",  title: "📬 Contact Me",   description: "Phone, Email & Address" },
                                { id: "btn_projects", title: "🚀 Our Projects", description: "Apps, Website & more" },
                                { id: "btn_website",  title: "🌐 Website",      description: BUSINESS_WEBSITE },
                                { id: "btn_call",     title: "📞 Call Us",      description: BUSINESS_PHONE }
                            ]
                        },
                        {
                            title: "🍔 Order Food",
                            rows: [
                                { id: "menu",  title: "📋 View Menu",    description: "See all available dishes" },
                                { id: "order", title: "🛒 How to Order", description: "Type order [dish name]" }
                            ]
                        }
                    ]
                }
            });
        } catch (err2) {
            console.warn("⚠️ List message also failed, using plain text:", err2.message);
            await sock.sendMessage(sender, {
                text:
                    greetCaption + "\n\n" +
                    `📖 Type *about*        → About Us\n` +
                    `📬 Type *contact*      → Contact Info\n` +
                    `🚀 Type *projects*     → Our Projects\n` +
                    `📋 Type *menu*         → Food Menu\n` +
                    `🛒 Type *order [food]* → Place Order`
            });
        }
    }
}

// ─────────────────────────────────────────────────────────────
// 🤖 MAIN BOT
// ─────────────────────────────────────────────────────────────
async function startBot() {
    if (!FIREBASE_URL) {
        console.log("❌ ERROR: FIREBASE_URL is missing in GitHub Secrets!");
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

    // ── Connection Events ───────────────────────────────────
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

    // ── Message Handler ─────────────────────────────────────
    sock.ev.on('messages.upsert', async (m) => {

        // ✅ FIX 5 — Wrap ENTIRE handler in try/catch (stops crashes)
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
            if (msg.key.fromMe) return;

            const sender = msg.key.remoteJid;

            // ✅ FIX 1 — Drop message if user is spamming
            if (isRateLimited(sender)) {
                console.log(`⏳ Rate limited: ${sender.split('@')[0]}`);
                return;
            }

            const text = (
                msg.message.conversation                                              ||
                msg.message.extendedTextMessage?.text                                ||
                msg.message.buttonsResponseMessage?.selectedButtonId                 ||
                msg.message.templateButtonReplyMessage?.selectedId                   ||
                msg.message.listResponseMessage?.singleSelectReply?.selectedRowId    ||
                ""
            ).toLowerCase().trim();

            console.log(`📩 From ${sender.split('@')[0]}: "${text}"`);

            // ══════════════════════════════════════════════
            // 🛒 ORDER STEP 2: Waiting for Address
            // ══════════════════════════════════════════════
            if (orderStates[sender]?.step === 'WAITING_FOR_ADDRESS') {
                const item            = orderStates[sender].item;
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

                // ✅ FIX 4 — Use retry-enabled Firebase post
                await postToFirebase(`${FIREBASE_URL}/orders.json`, javaGoatOrder);

                await sock.sendMessage(sender, {
                    text:
                        `✅ *Order Placed Successfully!*\n\n` +
                        `Thank you! Your order for *${item.name}* is being prepared. 👨‍🍳\n\n` +
                        `*Total:* ₹${javaGoatOrder.total} (Inc. ₹50 Delivery)\n` +
                        `*Payment:* Cash on Delivery\n` +
                        `*Status:* 🟡 Preparing\n\n` +
                        `We will deliver to your address soon! 🚀`
                });

                delete orderStates[sender];
                return;
            }

            // ── 📖 About ──────────────────────────────────
            if (['btn_about','about','about me','aboutme'].includes(text)) {
                await sock.sendMessage(sender, { text: BUSINESS_ABOUT });
                await sock.sendMessage(sender, {
                    text: `💡 Type *menu* to see our food, or *order [dish]* to order!\nOr say *hi* to see the full profile again. 😊`
                });
                return;
            }

            // ── 📬 Contact ────────────────────────────────
            if (['btn_contact','contact','contact me','contactme'].includes(text) || text.includes("call")) {
                await sock.sendMessage(sender, { text: BUSINESS_CONTACT });
                return;
            }

            // ── 🚀 Projects ───────────────────────────────
            if (['btn_projects','projects','project','portfolio'].includes(text)) {
                await sock.sendMessage(sender, { text: BUSINESS_PROJECTS });
                return;
            }

            // ── 🌐 Website ────────────────────────────────
            if (['btn_website','website'].includes(text)) {
                await sock.sendMessage(sender, {
                    text: `🌐 *Visit Our Website*\n\n👉 ${BUSINESS_WEBSITE}\n\nBrowse our menu, track your orders, and more!`
                });
                return;
            }

            // ── 📞 Call ───────────────────────────────────
            if (text === 'btn_call') {
                await sock.sendMessage(sender, {
                    text: `📞 *Call Us Now!*\n\n👉 ${BUSINESS_PHONE}\n\n🕘 Available *9 AM – 10 PM* daily!`
                });
                return;
            }

            // ── 🛒 Order Step 1 ─────���─────────────────────
            if (text.startsWith("order ")) {
                const productRequested = text.replace("order ", "").trim();
                const currentMenu      = await getMenuFromApp(); // ✅ Uses cache
                const matchedItem      = currentMenu.find(i => i.name.toLowerCase().includes(productRequested));

                if (!matchedItem) {
                    await sock.sendMessage(sender, {
                        text: `❌ Sorry, we couldn't find *${productRequested}* in our menu today.\n\nType *menu* to see all available items.`
                    });
                    return;
                }

                orderStates[sender] = { step: 'WAITING_FOR_ADDRESS', item: matchedItem };

                const captionText =
                    `🛒 *Order Started!*\n\n` +
                    `You selected: *${matchedItem.name}* (₹${matchedItem.price})\n` +
                    `🚚 *Delivery Fee:* ₹50\n` +
                    `💰 *Total:* ₹${parseFloat(matchedItem.price) + 50}\n\n` +
                    `Please reply with your:\n*Full Name, Phone Number & Delivery Address*`;

                if (matchedItem.imageUrl) {
                    await sock.sendMessage(sender, { image: { url: matchedItem.imageUrl }, caption: captionText });
                } else {
                    await sock.sendMessage(sender, { text: captionText });
                }
                return;
            }

            // ── 🛒 Order Help ─────────────────────────────
            if (text === "order") {
                await sock.sendMessage(sender, {
                    text: `🛒 *How to Order:*\n\nType *order* followed by the dish name.\n\n*Example:* order pizza\n*Example:* order burger\n\nOr type *menu* to see all dishes first! 📋`
                });
                return;
            }

            // ── 📋 Live Menu ──────────────────────────────
            if (text === "menu" || text.includes("price") || text.includes("list") || text.includes("food")) {
                const currentMenu = await getMenuFromApp(); // ✅ Uses cache

                if (currentMenu.length === 0) {
                    await sock.sendMessage(sender, { text: "⏳ Our menu is currently updating. Please check back in a few minutes!" });
                    return;
                }

                let menuMessage = `🍔 *JAVAGOAT LIVE MENU* 🍕\n━━━━━━━━━━━━━━━━━━━━\n\n`;
                currentMenu.forEach((item, index) => {
                    menuMessage += `${index + 1}. 🔸 *${item.name}*\n   💰 ₹${item.price}\n\n`;
                });
                menuMessage += `━━━━━━━━━━━━━━━━━━━━\n_Type *order [dish name]* to order!_\n_Example: order pizza_`;

                await sock.sendMessage(sender, { text: menuMessage });
                return;
            }

            // ── 👋 Greeting ───────────────────────────────
            if (["hi","hello","hey","start","hii","helo"].some(g => text.includes(g))) {
                await sendProfileCard(sock, sender);
                return;
            }

            // ── 🤔 Fallback ───────────────────────────────
            await sock.sendMessage(sender, {
                text:
                    `🤔 I didn't quite catch that.\n\n` +
                    `Here's what I can do:\n\n` +
                    `👋 *hi*              → Profile + Buttons\n` +
                    `📖 *about*           → About JavaGoat\n` +
                    `📬 *contact*         → Contact Info\n` +
                    `🚀 *projects*        → Our Projects\n` +
                    `📋 *menu*            → Food Menu\n` +
                    `🛒 *order [food]*    → Place an Order\n\n` +
                    `_Say *hi* to see our full profile!_ 😊`
            });

        } catch (err) {
            // ✅ FIX 5 — Bot NEVER crashes, just logs the error
            console.error("❌ Message handler error (non-fatal):", err.message);
        }
    });
}

// ✅ FIX 6 — Global safety nets to prevent ANY unhandled crash
process.on('unhandledRejection', (reason) => {
    console.error('⚠️ Unhandled Rejection (caught globally):', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught Exception (caught globally):', err.message);
});

startBot().catch(err => console.log("❌ Startup Error: " + err));
