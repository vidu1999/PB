const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// 🌟 SECURE FIREBASE URL FROM GITHUB SECRETS 🌟
const FIREBASE_URL = process.env.FIREBASE_URL;

// ============================================================
// 🖼️ YOUR BUSINESS PROFILE INFO — EDIT THESE
// ============================================================
const PROFILE_PHOTO_URL = "https://your-image-url.com/javagoat-logo.jpg"; // 🔁 Replace with your actual image URL
const BUSINESS_NAME     = "JavaGoat";
const BUSINESS_ABOUT    = "🍔 We serve the freshest burgers, pizzas & more — delivered hot to your door!";
const BUSINESS_WEBSITE  = "https://www.javagoat.com";       // 🔁 Replace with your website
const BUSINESS_PHONE    = "+911234567890";                  // 🔁 Replace with your phone number
const BUSINESS_EMAIL    = "support@javagoat.com";
// ============================================================

const orderStates = {};

// Function to fetch the dynamic menu from your App's Firebase
async function getMenuFromApp() {
    try {
        const response = await fetch(`${FIREBASE_URL}/dishes.json`);
        const data = await response.json();
        if (!data) return [];

        return Object.keys(data).map(key => ({
            id: key,
            name: data[key].name,
            price: data[key].price,
            imageUrl: data[key].imageUrl
        }));
    } catch (error) {
        console.error("Failed to fetch menu:", error);
        return [];
    }
}

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

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
        if (msg.key.fromMe) return; // Loop Protection

        const sender = msg.key.remoteJid;

        // ✅ Read both normal text AND button tap responses
        const text = (
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.buttonsResponseMessage?.selectedButtonId ||   // Button tap ID
            msg.message.templateButtonReplyMessage?.selectedId ||     // Template button tap ID
            ""
        ).toLowerCase();

        console.log(`📩 Query: ${text}`);

        // ================================================================
        // 🛒 STEP 2: FINISH ORDER & SEND TO ADMIN PANEL
        // ================================================================
        if (orderStates[sender]?.step === 'WAITING_FOR_ADDRESS') {
            const customerDetails = text;
            const item = orderStates[sender].item;
            const customerWaNumber = sender.split('@')[0];

            const javaGoatOrder = {
                userId:     "whatsapp_" + customerWaNumber,
                userEmail:  "whatsapp@javagoat.com",
                phone:      customerWaNumber,
                address:    customerDetails,
                location:   { lat: 0, lng: 0 },
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
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(javaGoatOrder)
                });
            } catch (error) {
                console.log("Firebase Error: ", error);
            }

            await sock.sendMessage(sender, {
                text: `✅ *Order Placed Successfully!*\n\nThank you! Your order for *${item.name}* is being prepared.\n\n*Total:* ₹${javaGoatOrder.total} (Inc. Delivery)\n*Status:* Preparing\n\nWe will deliver it to your address soon. 🚀`
            });
            delete orderStates[sender];
            return;
        }

        // ================================================================
        // 🔘 BUTTON TAP HANDLERS
        // ================================================================

        // 📖 About Button
        if (text === 'btn_about') {
            await sock.sendMessage(sender, {
                text: `📖 *About ${BUSINESS_NAME}*\n\n${BUSINESS_ABOUT}\n\n✨ We believe in quality food, fast delivery, and happy customers!\n\nType *menu* to see our dishes.`
            });
            return;
        }

        // 📞 Contact Button
        if (text === 'btn_contact') {
            await sock.sendMessage(sender, {
                text: `📞 *Contact ${BUSINESS_NAME}*\n\n📱 *Phone:* ${BUSINESS_PHONE}\n📧 *Email:* ${BUSINESS_EMAIL}\n🌐 *Website:* ${BUSINESS_WEBSITE}\n\nWe're available *9 AM – 10 PM* every day!`
            });
            return;
        }

        // ================================================================
        // 🌟 STEP 1: START ORDER FLOW
        // ================================================================
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

            const captionText = `🛒 *Order Started!*\n\nYou selected: *${matchedItem.name}* (₹${matchedItem.price})\n\nPlease reply with your *Full Name, Phone Number, and Delivery Address*.`;

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
                text: "🛒 *How to order:*\nType 'order' followed by the dish name.\nExample: *order pizza*"
            });
        }

        // ================================================================
        // 📋 DYNAMIC MENU
        // ================================================================
        else if (text.includes("menu") || text.includes("price") || text.includes("list") || text.includes("food")) {
            const currentMenu = await getMenuFromApp();

            if (currentMenu.length === 0) {
                await sock.sendMessage(sender, { text: "Our menu is currently empty or updating. Please check back soon!" });
                return;
            }

            let menuMessage = "🍔 *JAVAGOAT LIVE MENU* 🍕\n\n";
            currentMenu.forEach(item => {
                menuMessage += `🔸 *${item.name}* - ₹${item.price}\n`;
            });
            menuMessage += "\n_To order, reply with 'order [dish name]'_";

            await sock.sendMessage(sender, { text: menuMessage });
        }

        // ================================================================
        // 👋 GREETING — Profile Photo + Buttons
        // ================================================================
        else if (text.includes("hi") || text.includes("hello") || text.includes("hey")) {

            const greetCaption =
                `👋 *Welcome to ${BUSINESS_NAME}!*\n\n` +
                `${BUSINESS_ABOUT}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `🌐 *Website:* ${BUSINESS_WEBSITE}\n` +
                `📧 *Email:*   ${BUSINESS_EMAIL}\n` +
                `📱 *Phone:*   ${BUSINESS_PHONE}\n` +
                `━━━━━━━━━━━━━━━━━━━━\n\n` +
                `Use the buttons below or type *menu* to get started! 🚀`;

            try {
                // ✅ Send profile photo + interactive template buttons (Call + URL + Quick Replies)
                await sock.sendMessage(sender, {
                    image: { url: PROFILE_PHOTO_URL },
                    caption: greetCaption,
                    // 🔘 Template Buttons: Call, Website URL, About, Contact
                    templateButtons: [
                        {
                            index: 1,
                            callButton: {
                                displayText: '📞 Call Us',
                                phoneNumber: BUSINESS_PHONE   // ☎️ Tap-to-call button
                            }
                        },
                        {
                            index: 2,
                            urlButton: {
                                displayText: '🌐 Visit Website',
                                url: BUSINESS_WEBSITE         // 🌐 Opens website in browser
                            }
                        },
                        {
                            index: 3,
                            quickReplyButton: {
                                displayText: '📖 About Us',
                                id: 'btn_about'               // Handled above
                            }
                        },
                        {
                            index: 4,
                            quickReplyButton: {
                                displayText: '📞 Contact Info',
                                id: 'btn_contact'             // Handled above
                            }
                        }
                    ],
                    footer: `${BUSINESS_NAME} AI Assistant`
                });
            } catch (err) {
                // 📌 Fallback: if buttons fail (older WA versions), send plain text
                console.warn("⚠️ Template buttons failed, sending plain text:", err.message);
                await sock.sendMessage(sender, { text: greetCaption });
            }
        }

        // ================================================================
        // 📞 CONTACT SHORTCUT
        // ================================================================
        else if (text.includes("contact") || text.includes("call")) {
            await sock.sendMessage(sender, {
                text: `📞 *Contact ${BUSINESS_NAME}*\n\n📱 *Phone:* ${BUSINESS_PHONE}\n📧 *Email:* ${BUSINESS_EMAIL}\n🌐 *Website:* ${BUSINESS_WEBSITE}\n\nWe're available *9 AM – 10 PM* every day!`
            });
        }

        // ================================================================
        // 🤔 DEFAULT FALLBACK
        // ================================================================
        else {
            await sock.sendMessage(sender, {
                text: "🤔 I didn't quite catch that.\n\nType *menu* to see our food list, or *order [food]* to place an order!\n\nOr say *hi* to see our full profile. 😊"
            });
        }
    });
}

startBot().catch(err => console.log("Error: " + err));
