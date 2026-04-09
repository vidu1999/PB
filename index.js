const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// 🌟 SECURE FIREBASE URL FROM GITHUB SECRETS 🌟
const FIREBASE_URL = process.env.FIREBASE_URL;

// ============================================================
// 🖼️ YOUR BUSINESS PROFILE INFO — EDIT THESE
// ============================================================
const PROFILE_PHOTO_URL = "https://your-image-url.com/javagoat-logo.jpg"; // 🔁 Your photo/logo URL
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

const BUSINESS_CONTACT  =
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

const BUSINESS_WEBSITE  = "https://www.javagoat.com";   // 🔁 Your website
const BUSINESS_PHONE    = "+911234567890";              // 🔁 Your phone number
// ============================================================

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
// 🚀 Helper: Send Profile Card with 5 Clickable Buttons
// ─────────────────────────────────────────────────────────────
async function sendProfileCard(sock, sender) {
    const greetCaption =
        `👋 *Welcome to ${BUSINESS_NAME}!*\n\n` +
        `${BUSINESS_TAGLINE}\n\n` +
        `━━━━━━━��━━━━━━━━━━━━\n` +
        `🌐 ${BUSINESS_WEBSITE}\n` +
        `📱 ${BUSINESS_PHONE}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👇 *Tap a button below to explore us!*`;

    try {
        // ✅ PRIMARY: Image + 5 Template Buttons
        await sock.sendMessage(sender, {
            image: { url: PROFILE_PHOTO_URL },
            caption: greetCaption,
            footer: `${BUSINESS_NAME} • AI Assistant 🤖`,
            templateButtons: [
                {
                    index: 1,
                    callButton: {
                        displayText: '📞 Call Us',
                        phoneNumber: BUSINESS_PHONE          // ☎️ Opens dialer with number
                    }
                },
                {
                    index: 2,
                    urlButton: {
                        displayText: '🌐 Visit Website',
                        url: BUSINESS_WEBSITE                // 🌐 Opens website in browser
                    }
                },
                {
                    index: 3,
                    quickReplyButton: {
                        displayText: '📖 About Me',
                        id: 'btn_about'                      // Sends back btn_about as text
                    }
                },
                {
                    index: 4,
                    quickReplyButton: {
                        displayText: '📬 Contact Me',
                        id: 'btn_contact'                    // Sends back btn_contact as text
                    }
                },
                {
                    index: 5,
                    quickReplyButton: {
                        displayText: '🚀 Projects',
                        id: 'btn_projects'                   // Sends back btn_projects as text
                    }
                }
            ]
        });
    } catch (err) {
        // ─────────────────────────────────────────────────────
        // ⚠️ FALLBACK: If templateButtons fail, send List Menu
        // (Works on all WhatsApp versions)
        // ─────────────────────────────────────────────────────
        console.warn("⚠️ Template buttons failed, trying list message:", err.message);
        try {
            await sock.sendMessage(sender, {
                image: { url: PROFILE_PHOTO_URL },
                caption: greetCaption
            });
            await sock.sendMessage(sender, {
                listMessage: {
                    title:       `👋 Welcome to ${BUSINESS_NAME}!`,
                    text:        `Explore us using the options below 👇`,
                    footer:      `${BUSINESS_NAME} AI Assistant 🤖`,
                    buttonText:  `📋 EXPLORE OPTIONS`,
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
            // ─────────────────────────────────────────────────
            // 🆘 FINAL FALLBACK: Plain text if everything fails
            // ─────────────────────────────────────────────────
            console.warn("⚠️ List message also failed, using plain text:", err2.message);
            await sock.sendMessage(sender, {
                text:
                    greetCaption + "\n\n" +
                    `📖 Type *about*    → About Us\n` +
                    `📬 Type *contact*  → Contact Info\n` +
                    `🚀 Type *projects* → Our Projects\n` +
                    `📋 Type *menu*     → Food Menu\n` +
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

        // ✅ Capture ALL message types including button taps
        const text = (
            msg.message.conversation                                 ||
            msg.message.extendedTextMessage?.text                   ||
            msg.message.buttonsResponseMessage?.selectedButtonId    || // Button tap
            msg.message.templateButtonReplyMessage?.selectedId      || // Template tap
            msg.message.listResponseMessage?.singleSelectReply?.selectedRowId || // List tap
            ""
        ).toLowerCase().trim();

        console.log(`📩 Message from ${sender.split('@')[0]}: "${text}"`);

        // ════════════════════════════════════════════════════
        // 🛒 ORDER STEP 2: Waiting for Address
        // ════════════════════════════════════════════════════
        if (orderStates[sender]?.step === 'WAITING_FOR_ADDRESS') {
            const customerDetails = text;
            const item            = orderStates[sender].item;
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
        // 🔘 BUTTON TAP / KEYWORD HANDLERS
        // ════════════════════════════════════════════════════

        // ── 📖 About Me ─────────────────────────────────────
        if (text === 'btn_about' || text === 'about' || text === 'about me' || text === 'aboutme') {
            await sock.sendMessage(sender, { text: BUSINESS_ABOUT });
            await sock.sendMessage(sender, {
                text: `💡 Type *menu* to see our food, or *order [dish]* to order!\nOr say *hi* to see the full profile again. 😊`
            });
            return;
        }

        // ── 📬 Contact Me ────────────────────────────────────
        if (text === 'btn_contact' || text === 'contact' || text === 'contact me' || text === 'contactme' || text.includes("call")) {
            await sock.sendMessage(sender, { text: BUSINESS_CONTACT });
            return;
        }

        // ── 🚀 Projects ──────────────────────────────────────
        if (text === 'btn_projects' || text === 'projects' || text === 'project' || text === 'portfolio') {
            await sock.sendMessage(sender, { text: BUSINESS_PROJECTS });
            return;
        }

        // ── 🌐 Website (List tap) ─────────────────────────────
        if (text === 'btn_website' || text === 'website') {
            await sock.sendMessage(sender, {
                text: `🌐 *Visit Our Website*\n\n👉 ${BUSINESS_WEBSITE}\n\nBrowse our menu, track your orders, and more!`
            });
            return;
        }

        // ── 📞 Call (List tap) ───────────────────────────────
        if (text === 'btn_call') {
            await sock.sendMessage(sender, {
                text: `📞 *Call Us Now!*\n\n👉 ${BUSINESS_PHONE}\n\n🕘 Available *9 AM – 10 PM* daily!`
            });
            return;
        }

        // ════════════════════════════════════════════════════
        // 🌟 ORDER STEP 1: Start Order Flow
        // ════════════════════════════════════════════════════
        if (text.startsWith("order ")) {
            const productRequested = text.replace("order ", "").trim().toLowerCase();
            const currentMenu = await getMenuFromApp();
            const matchedItem = currentMenu.find(item => item.name.toLowerCase().includes(productRequested));

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
        }

        else if (text === "order") {
            await sock.sendMessage(sender, {
                text: `🛒 *How to Order:*\n\nType *order* followed by the dish name.\n\n*Example:* order pizza\n*Example:* order burger\n\nOr type *menu* to see all dishes first! 📋`
            });
        }

        // ════════════════════════════════════════════════════
        // 📋 Dynamic Live Menu
        // ════════════════════════════════════════════════════
        else if (text === "menu" || text.includes("price") || text.includes("list") || text.includes("food")) {
            const currentMenu = await getMenuFromApp();

            if (currentMenu.length === 0) {
                await sock.sendMessage(sender, { text: "⏳ Our menu is currently updating. Please check back in a few minutes!" });
                return;
            }

            let menuMessage = `🍔 *JAVAGOAT LIVE MENU* 🍕\n`;
            menuMessage += `━━━━━━━━━━━━━━━━━━━━\n\n`;
            currentMenu.forEach((item, index) => {
                menuMessage += `${index + 1}. 🔸 *${item.name}*\n   💰 ₹${item.price}\n\n`;
            });
            menuMessage += `━━━━━━━━━━━━━━━━━━━━\n`;
            menuMessage += `_Type *order [dish name]* to order!_\n`;
            menuMessage += `_Example: order pizza_`;

            await sock.sendMessage(sender, { text: menuMessage });
        }

        // ════════════════════════════════════════════════════
        // 👋 GREETING — Profile Card + 5 Clickable Buttons
        // ════════════════════════════════════════════════════
        else if (
            text.includes("hi")    ||
            text.includes("hello") ||
            text.includes("hey")   ||
            text.includes("start") ||
            text === "hii"         ||
            text === "helo"
        ) {
            await sendProfileCard(sock, sender); // 🌟 Sends photo + all 5 buttons
        }

        // ════════════════════════════════════════════════════
        // 🤔 Default Fallback
        // ════════════════════════════════════════════════════
        else {
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
        }
    });
}

startBot().catch(err => console.log("❌ Error: " + err));
