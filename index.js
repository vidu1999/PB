const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { sendButtons, sendInteractiveMessage } = require('baileys_helper'); // ✅ THE FIX
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// 🌟 SECURE FIREBASE URL FROM GITHUB SECRETS 🌟
const FIREBASE_URL = process.env.FIREBASE_URL;

// ============================================================
// 🖼️ YOUR BUSINESS PROFILE INFO — EDIT THESE
// ============================================================
const PROFILE_PHOTO_URL = "https://your-image-url.com/javagoat-logo.jpg";
const BUSINESS_NAME     = "JavaGoat";
const BUSINESS_TAGLINE  = "🍔 Fresh burgers, pizzas & more — hot delivered to your door!";
const BUSINESS_PHONE    = "+911234567890";   // 🔁 Your phone number
const BUSINESS_WEBSITE  = "https://www.javagoat.com"; // 🔁 Your website
const BUSINESS_EMAIL    = "support@javagoat.com";
// ============================================================

const BUSINESS_ABOUT =
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
    `📱 *Phone:*   ${BUSINESS_PHONE}\n` +
    `📧 *Email:*   ${BUSINESS_EMAIL}\n` +
    `🌐 *Website:* ${BUSINESS_WEBSITE}\n` +
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
    `   🔗 ${BUSINESS_WEBSITE}\n\n` +
    `🤖 *WhatsApp AI Bot*\n` +
    `   Order food directly via WhatsApp\n` +
    `   🔗 You're using it right now!\n\n` +
    `📊 *Admin Dashboard*\n` +
    `   Live order management panel\n` +
    `   🔗 https://admin.javagoat.com\n\n` +
    `_More projects coming soon... 🔥_`;

const orderStates = {};

// ─────────────────────────────────────────────────────────────
// 📡 Fetch Live Menu from Firebase
// ─────────────────────────────────────────────────────────────
async function getMenuFromApp() {
    try {
        const response = await fetch(`${FIREBASE_URL}/dishes.json`);
        const data = await response.json();
        if (!data) return [];
        return Object.keys(data).map(key => ({
            id:       key,
            name:     data[key].name,
            price:    data[key].price,
            imageUrl: data[key].imageUrl
        }));
    } catch (error) {
        console.error("Failed to fetch menu:", error);
        return [];
    }
}

// ─────────────────────────────────────────────────────────────
// 🌟 Send Profile Card with REAL Clickable Buttons
// Uses baileys_helpers — works on ALL WhatsApp versions
// ─────────────────────────────────────────────────────────────
async function sendProfileCard(sock, sender) {
    const bodyText =
        `👋 *Welcome to ${BUSINESS_NAME}!*\n\n` +
        `${BUSINESS_TAGLINE}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🌐 ${BUSINESS_WEBSITE}\n` +
        `📱 ${BUSINESS_PHONE}\n` +
        `📧 ${BUSINESS_EMAIL}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👇 *Tap a button below to explore!*`;

    try {
        // ✅ STEP 1: Send Profile Photo first
        await sock.sendMessage(sender, {
            image: { url: PROFILE_PHOTO_URL },
            caption: bodyText
        });

        // ✅ STEP 2: Send Interactive Buttons using baileys_helpers
        // These are REAL WhatsApp native buttons — no 403 error!
        await sendInteractiveMessage(sock, sender, {
            text:   `What would you like to know about *${BUSINESS_NAME}*?`,
            footer: `${BUSINESS_NAME} AI Assistant 🤖`,
            interactiveButtons: [
                // 📖 About Me — Quick Reply Button
                {
                    name: 'quick_reply',
                    buttonParamsJson: JSON.stringify({
                        display_text: '📖 About Me',
                        id: 'btn_about'
                    })
                },
                // 📬 Contact Me — Quick Reply Button
                {
                    name: 'quick_reply',
                    buttonParamsJson: JSON.stringify({
                        display_text: '📬 Contact Me',
                        id: 'btn_contact'
                    })
                },
                // 🚀 Projects — Quick Reply Button
                {
                    name: 'quick_reply',
                    buttonParamsJson: JSON.stringify({
                        display_text: '🚀 Projects',
                        id: 'btn_projects'
                    })
                },
                // 🌐 Website — URL Button (opens browser)
                {
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                        display_text: '🌐 Visit Website',
                        url: BUSINESS_WEBSITE,
                        merchant_url: BUSINESS_WEBSITE
                    })
                },
                // 📞 Call — Phone Call Button (opens dialer)
                {
                    name: 'cta_call',
                    buttonParamsJson: JSON.stringify({
                        display_text: '📞 Call Us',
                        phone_number: BUSINESS_PHONE
                    })
                }
            ]
        });

        console.log("✅ Profile card with interactive buttons sent successfully!");

    } catch (err) {
        // ─────────────────────────────────────────────────────
        // ⚠️ FALLBACK: Plain text with keyword instructions
        // ─────────────────────────────────────────────────────
        console.warn("⚠️ Interactive buttons failed, using plain text fallback:", err.message);
        await sock.sendMessage(sender, {
            text:
                bodyText + "\n\n" +
                `*Reply with a keyword:*\n` +
                `📖 Type *about*    → About Us\n` +
                `📬 Type *contact*  → Contact Info\n` +
                `🚀 Type *projects* → Our Projects\n` +
                `🌐 Type *website*  → Website Link\n` +
                `📞 Type *call*     → Phone Number\n` +
                `📋 Type *menu*     → Food Menu\n` +
                `🛒 Type *order [food]* → Place Order`
        });
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
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["S", "K", "1"]
    });

    // ── Connection Events ────────────────────────────────────
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.clear();
            console.log('\n==================================================');
            console.log('⚠️ QR CODE TOO BIG? CLICK "View raw logs" in top right!');
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
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
        if (msg.key.fromMe) return; // Loop Protection

        const sender = msg.key.remoteJid;

        // ✅ Capture ALL message types including interactive button taps
        const text = (
            msg.message.conversation                                               ||
            msg.message.extendedTextMessage?.text                                 ||
            msg.message.buttonsResponseMessage?.selectedButtonId                  || // Old buttons
            msg.message.templateButtonReplyMessage?.selectedId                    || // Template
            msg.message.listResponseMessage?.singleSelectReply?.selectedRowId     || // List
            msg.message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson // ✅ NEW: Interactive buttons
                ? (() => {
                    try {
                        return JSON.parse(
                            msg.message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson || '{}'
                        ).id || '';
                    } catch { return ''; }
                })()
                : ""
        ).toLowerCase().trim();

        console.log(`📩 Message from ${sender.split('@')[0]}: "${text}"`);

        // ════════════════════════════════════════════════════
        // 🛒 ORDER STEP 2: Waiting for Address
        // ════════════════════════════════════════════════════
        if (orderStates[sender]?.step === 'WAITING_FOR_ADDRESS') {
            const customerDetails  = text;
            const item             = orderStates[sender].item;
            const customerWaNumber = sender.split('@')[0];

            const javaGoatOrder = {
                userId:    "whatsapp_" + customerWaNumber,
                userEmail: "whatsapp@javagoat.com",
                phone:     customerWaNumber,
                address:   customerDetails,
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

            try {
                await fetch(`${FIREBASE_URL}/orders.json`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(javaGoatOrder)
                });
            } catch (error) {
                console.log("Firebase Error:", error);
            }

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

        // ════════════════════════════════════════════════════
        // 🔘 BUTTON TAP + KEYWORD HANDLERS
        // ════════════════════════════════════════════════════

        // ── 📖 About Me ──────────────────────────────────────
        if (['btn_about', 'about', 'about me', 'aboutme'].includes(text)) {
            await sock.sendMessage(sender, { text: BUSINESS_ABOUT });
            await sock.sendMessage(sender, {
                text: `💡 Type *menu* to see our food, or say *hi* to see the profile again. 😊`
            });
            return;
        }

        // ── 📬 Contact Me ────────────────────────────────────
        if (['btn_contact', 'contact', 'contact me', 'contactme'].includes(text) || text.includes('contact')) {
            await sock.sendMessage(sender, { text: BUSINESS_CONTACT });
            return;
        }

        // ── 🚀 Projects ──────────────────────────────────────
        if (['btn_projects', 'projects', 'project', 'portfolio'].includes(text)) {
            await sock.sendMessage(sender, { text: BUSINESS_PROJECTS });
            return;
        }

        // ── 🌐 Website ───────────────────────────────────────
        if (['btn_website', 'website', 'web', 'site'].includes(text)) {
            await sock.sendMessage(sender, {
                text: `🌐 *Visit Our Website*\n\n👉 ${BUSINESS_WEBSITE}\n\nBrowse our menu, track your orders & more!`
            });
            return;
        }

        // ── 📞 Call ──────────────────────────────────────────
        if (['btn_call', 'call', 'phone', 'number'].includes(text)) {
            await sock.sendMessage(sender, {
                text: `📞 *Call Us Now!*\n\n👉 ${BUSINESS_PHONE}\n\n🕘 Available *9 AM – 10 PM* daily!`
            });
            return;
        }

        // ════════════════════════════════════════════════════
        // 🌟 ORDER STEP 1: Start Order Flow
        // ════════════════════════════════════════════════════
        if (text.startsWith("order ")) {
            const productRequested = text.replace("order ", "").trim();
            const currentMenu      = await getMenuFromApp();
            const matchedItem      = currentMenu.find(item =>
                item.name.toLowerCase().includes(productRequested)
            );

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
                await sock.sendMessage(sender, {
                    image:   { url: matchedItem.imageUrl },
                    caption: captionText
                });
            } else {
                await sock.sendMessage(sender, { text: captionText });
            }
            return;
        }

        if (text === "order") {
            await sock.sendMessage(sender, {
                text: `🛒 *How to Order:*\n\nType *order* followed by the dish name.\n\n*Example:* order pizza\n*Example:* order burger\n\nOr type *menu* to see all dishes first! 📋`
            });
            return;
        }

        // ════════════════════════════════════════════════════
        // 📋 Dynamic Live Menu
        // ════════════════════════════════════════════════════
        if (["menu", "price", "list", "food"].some(k => text.includes(k))) {
            const currentMenu = await getMenuFromApp();

            if (currentMenu.length === 0) {
                await sock.sendMessage(sender, {
                    text: "⏳ Our menu is currently updating. Please check back in a few minutes!"
                });
                return;
            }

            let menuMessage  = `🍔 *JAVAGOAT LIVE MENU* 🍕\n`;
            menuMessage     += `━━━━━━━━━━━━━━━━━━━━\n\n`;
            currentMenu.forEach((item, index) => {
                menuMessage += `${index + 1}. 🔸 *${item.name}*\n   💰 ₹${item.price}\n\n`;
            });
            menuMessage += `━━━━━━━━━━━━━━━━━━━━\n`;
            menuMessage += `_Type *order [dish name]* to order!_\n`;
            menuMessage += `_Example: order pizza_`;

            await sock.sendMessage(sender, { text: menuMessage });
            return;
        }

        // ════════════════════════════════════════════════════
        // 👋 GREETING — Profile Photo + 5 Native Buttons
        // ════════════════════════════════════════════════════
        if (["hi", "hello", "hey", "start", "hii", "helo"].some(k => text.includes(k))) {
            await sendProfileCard(sock, sender); // ✅ Sends photo + all 5 native buttons
            return;
        }

        // ════════════════════════════════════════════════════
        // 🤔 Default Fallback
        // ════════════════════════════════════════════════════
        await sock.sendMessage(sender, {
            text:
                `🤔 I didn't quite catch that.\n\n` +
                `Here's what I can do:\n\n` +
                `👋 *hi*              → Profile + Buttons\n` +
                `📖 *about*           → About JavaGoat\n` +
                `📬 *contact*         → Contact Info\n` +
                `🚀 *projects*        → Our Projects\n` +
                `🌐 *website*         → Website Link\n` +
                `📞 *call*            → Phone Number\n` +
                `📋 *menu*            → Food Menu\n` +
                `🛒 *order [food]*    → Place an Order\n\n` +
                `_Say *hi* to see our full profile!_ 😊`
        });
    });
}

startBot().catch(err => console.log("❌ Error: " + err));
