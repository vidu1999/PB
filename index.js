const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// 🌟 SECURE FIREBASE URL FROM GITHUB SECRETS 🌟
const FIREBASE_URL = process.env.FIREBASE_URL;

// ============================================================
// 🖼️ YOUR BUSINESS PROFILE INFO — EDIT THESE
// ============================================================
const PROFILE_PHOTO_URL = "https://i.imgur.com/4kxqS3p.jpg"; // 🔁 Replace with your image
const BUSINESS_NAME     = "JavaGoat";
const BUSINESS_TAGLINE  = "🍔 Fresh burgers, pizzas & more — hot delivered to your door!";
const BUSINESS_PHONE    = "+911234567890";
const BUSINESS_WEBSITE  = "https://www.javagoat.com";
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
// 🌟 Send Profile Card with Native WhatsApp Buttons
// This uses ONLY what Baileys supports natively — NO 403 errors!
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
        `👇 *Tap a button below!*`;

    try {
        // ✅ METHOD 1: Send Photo + Simple Buttons (WORKS!)
        // First send the profile photo
        await sock.sendMessage(sender, {
            image: { url: PROFILE_PHOTO_URL },
            caption: bodyText
        });

        // Then send buttons message with native Baileys format
        const buttons = [
            { buttonId: 'btn_about',    buttonText: { displayText: '📖 About Me' },    type: 1 },
            { buttonId: 'btn_contact',  buttonText: { displayText: '📬 Contact Me' },  type: 1 },
            { buttonId: 'btn_projects', buttonText: { displayText: '🚀 Projects' },    type: 1 }
        ];

        const buttonMessage = {
            text: `What would you like to know about *${BUSINESS_NAME}*?`,
            footer: `${BUSINESS_NAME} AI Assistant 🤖`,
            buttons: buttons,
            headerType: 1
        };

        await sock.sendMessage(sender, buttonMessage);

        // Send website and call links as separate messages
        await sock.sendMessage(sender, {
            text: `🌐 *Visit Website:* ${BUSINESS_WEBSITE}\n\n📞 *Call Us:* ${BUSINESS_PHONE}`
        });

        console.log("✅ Profile card sent successfully!");

    } catch (err) {
        console.warn("⚠️ Buttons failed, using text-only fallback:", err.message);
        
        // ⚠️ FALLBACK: Plain text with clear instructions
        await sock.sendMessage(sender, {
            image: { url: PROFILE_PHOTO_URL },
            caption: 
                bodyText + "\n\n" +
                `*Quick Actions - Just type:*\n\n` +
                `📖 *about*    → Learn about us\n` +
                `📬 *contact*  → Get contact info\n` +
                `🚀 *projects* → See our projects\n` +
                `🌐 *website*  → Get website link\n` +
                `📞 *call*     → Get phone number\n` +
                `📋 *menu*     → View food menu\n` +
                `🛒 *order [dish]* → Place order\n\n` +
                `_Example: Type "menu" or "order pizza"_`
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
        browser: ["JavaGoat", "Chrome", "1.0.0"]
    });

    // ── Connection Events ────────────────────────────────────
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.clear();
            console.log('\n==================================================');
            console.log('📱 SCAN THIS QR CODE WITH WHATSAPP');
            console.log('⚠️ QR CODE TOO BIG? CLICK "View raw logs" ABOVE!');
            console.log('==================================================\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open')  console.log('✅ JAVAGOAT AI IS ONLINE!');
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                console.log('⚠️ Connection closed, reconnecting...');
                setTimeout(() => startBot(), 3000);
            } else {
                console.log('❌ Logged out, please scan QR code again');
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // ── Message Handler ──────────────────────────────────────
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
        if (msg.key.fromMe) return; // Loop Protection

        const sender = msg.key.remoteJid;

        // ✅ Capture text from all message types
        const text = (
            msg.message.conversation                                 ||
            msg.message.extendedTextMessage?.text                   ||
            msg.message.buttonsResponseMessage?.selectedButtonId    || // ✅ Button taps
            msg.message.listResponseMessage?.singleSelectReply?.selectedRowId ||
            ""
        ).toLowerCase().trim();

        if (!text) return; // Ignore empty messages

        console.log(`📩 From ${sender.split('@')[0]}: "${text}"`);

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
                console.log("✅ Order saved to Firebase");
            } catch (error) {
                console.error("❌ Firebase Error:", error);
            }

            await sock.sendMessage(sender, {
                text:
                    `✅ *Order Placed Successfully!*\n\n` +
                    `Thank you! Your order for *${item.name}* is being prepared. 👨‍🍳\n\n` +
                    `💰 *Total:* ₹${javaGoatOrder.total} (Inc. ₹50 Delivery)\n` +
                    `💳 *Payment:* Cash on Delivery\n` +
                    `📍 *Status:* 🟡 Preparing\n\n` +
                    `We will deliver to your address soon! 🚀\n\n` +
                    `_Type *menu* to order more!_`
            });
            delete orderStates[sender];
            return;
        }

        // ════════════════════════════════════════════════════
        // 🔘 BUTTON TAP HANDLERS
        // ════════════════════════════════════════════════════

        if (text === 'btn_about' || ['about', 'about me', 'aboutme'].includes(text)) {
            await sock.sendMessage(sender, { text: BUSINESS_ABOUT });
            await sock.sendMessage(sender, {
                text: `💡 Type *menu* to see food, or *hi* to see profile again!`
            });
            return;
        }

        if (text === 'btn_contact' || ['contact', 'contact me', 'contactme'].includes(text)) {
            await sock.sendMessage(sender, { text: BUSINESS_CONTACT });
            return;
        }

        if (text === 'btn_projects' || ['projects', 'project', 'portfolio'].includes(text)) {
            await sock.sendMessage(sender, { text: BUSINESS_PROJECTS });
            return;
        }

        if (['website', 'web', 'site'].includes(text)) {
            await sock.sendMessage(sender, {
                text: `🌐 *Visit Our Website*\n\n👉 ${BUSINESS_WEBSITE}\n\nBrowse menu, track orders & more!`
            });
            return;
        }

        if (['call', 'phone', 'number'].includes(text)) {
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
                    text: `❌ Sorry, we couldn't find *"${productRequested}"* in our menu.\n\nType *menu* to see all available items.`
                });
                return;
            }

            orderStates[sender] = { step: 'WAITING_FOR_ADDRESS', item: matchedItem };

            const orderTotal    = parseFloat(matchedItem.price) + 50;
            const captionText =
                `🛒 *Order Started!*\n\n` +
                `✅ Selected: *${matchedItem.name}*\n` +
                `💰 Price: ₹${matchedItem.price}\n` +
                `🚚 Delivery: ₹50\n` +
                `━━━━━━━━━━━━━━━━\n` +
                `💳 *Total: ₹${orderTotal}*\n\n` +
                `📝 Please reply with:\n*Your Name, Phone & Delivery Address*`;

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
                text:
                    `🛒 *How to Order:*\n\n` +
                    `Type *order* followed by dish name.\n\n` +
                    `*Examples:*\n` +
                    `• order pizza\n` +
                    `• order burger\n` +
                    `• order pasta\n\n` +
                    `📋 Type *menu* to see all dishes!`
            });
            return;
        }

        // ════════════════════════════════════════════════════
        // 📋 Dynamic Live Menu
        // ════════════════════════════════════════════════════
        if (["menu", "price", "list", "food", "dishes"].some(k => text.includes(k))) {
            const currentMenu = await getMenuFromApp();

            if (currentMenu.length === 0) {
                await sock.sendMessage(sender, {
                    text: "⏳ Our menu is currently updating. Please check back in a moment!"
                });
                return;
            }

            let menuMessage  = `🍔 *${BUSINESS_NAME.toUpperCase()} LIVE MENU* 🍕\n`;
            menuMessage     += `━━━━━━━━━━━━━━━━━━━━\n\n`;
            
            currentMenu.forEach((item, index) => {
                menuMessage += `${index + 1}. *${item.name}*\n   💰 ₹${item.price}\n\n`;
            });
            
            menuMessage += `━━━━━━━━━━━━━━━━━━━━\n`;
            menuMessage += `🚚 Delivery: ₹50 extra\n\n`;
            menuMessage += `📝 *To order, type:*\n_order [dish name]_\n\n`;
            menuMessage += `*Example:* order pizza`;

            await sock.sendMessage(sender, { text: menuMessage });
            return;
        }

        // ════════════════════════════════════════════════════
        // 👋 GREETING — Profile Card with Buttons
        // ════════════════════════════════════════════════════
        if (["hi", "hello", "hey", "start", "hii", "helo", "yo"].some(k => text.includes(k))) {
            await sendProfileCard(sock, sender);
            return;
        }

        // ════════════════════════════════════════════════════
        // 🤔 Default Fallback
        // ════════════════════════════════════════════════════
        await sock.sendMessage(sender, {
            text:
                `🤔 I didn't understand that.\n\n` +
                `*Here's what I can help with:*\n\n` +
                `👋 Type *hi*         → See full profile\n` +
                `📖 Type *about*      → About us\n` +
                `📬 Type *contact*    → Contact info\n` +
                `🚀 Type *projects*   → Our projects\n` +
                `📋 Type *menu*       → Food menu\n` +
                `🛒 Type *order pizza* → Place order\n\n` +
                `_Start by saying *hi*!_ 😊`
        });
    });
}

startBot().catch(err => console.error("❌ Fatal Error:", err));
