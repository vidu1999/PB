const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// 🔥 IMPORTANT: Node 18+ required (for fetch)
// If not → npm install node-fetch and uncomment below:
// const fetch = require('node-fetch');

const FIREBASE_URL = process.env.FIREBASE_URL;

const orderStates = {};

// 🔥 FETCH MENU FROM FIREBASE
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
        console.error("❌ Menu fetch error:", error);
        return [];
    }
}

async function startBot() {

    if (!FIREBASE_URL) {
        console.log("❌ FIREBASE_URL missing!");
        process.exit(1);
    }

    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["JavaGoat", "Chrome", "1.0"]
    });

    // 🔥 CONNECTION
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.clear();
            console.log("📲 Scan QR Below:");
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') console.log("✅ BOT ONLINE");

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // 🔥 MAIN MESSAGE HANDLER
    sock.ev.on('messages.upsert', async (m) => {

        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
        if (msg.key.fromMe) return;

        const sender = msg.key.remoteJid;

        const text = (
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            ""
        ).toLowerCase();

        // 🔥 BUTTON CLICK DETECTION
        const buttonResponse = msg.message?.buttonsResponseMessage?.selectedButtonId;
        const listResponse = msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId;
        const selected = buttonResponse || listResponse;

        console.log("📩:", text || selected);

        // =========================================================
        // 🔥 BUTTON ACTIONS
        // =========================================================

        if (selected === 'about') {
            return await sock.sendMessage(sender, {
                text: `👤 *About Me*

I am Kavinda 🚀
Full Stack Developer & AI Developer

💡 Skills:
- React
- PHP
- Firebase
- Flutter
- AI Systems`
            });
        }

        if (selected === 'projects') {
            return await sock.sendMessage(sender, {
                text: `💻 *My Projects*

🚀 Food Ordering App
🤖 WhatsApp AI Bot
📱 Flutter Apps
🎮 Unity Games

More coming soon...`
            });
        }

        if (selected === 'contact') {
            return await sock.sendMessage(sender, {
                text: `📞 *Contact Me*

📧 Email: support@javagoat.com
📱 WhatsApp: ${sender.split('@')[0]}`
            });
        }

        if (selected === 'call') {
            return await sock.sendMessage(sender, {
                text: `📲 Call Me:

https://wa.me/${sender.split('@')[0]}`
            });
        }

        if (selected === 'web') {
            return await sock.sendMessage(sender, {
                text: `🌐 Visit My Website:

https://your-portfolio-link.com`
            });
        }

        // =========================================================
        // 🛒 ORDER FINAL STEP
        // =========================================================

        if (orderStates[sender]?.step === 'WAITING_FOR_ADDRESS') {

            const customerDetails = text;
            const item = orderStates[sender].item;
            const phone = sender.split('@')[0];

            const order = {
                userId: "whatsapp_" + phone,
                phone: phone,
                address: customerDetails,
                items: [{
                    id: item.id,
                    name: item.name,
                    price: parseFloat(item.price),
                    img: item.imageUrl || "",
                    quantity: 1
                }],
                total: (parseFloat(item.price) + 50).toFixed(2),
                status: "Placed",
                method: "Cash on Delivery",
                timestamp: new Date().toISOString()
            };

            await fetch(`${FIREBASE_URL}/orders.json`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(order)
            });

            await sock.sendMessage(sender, {
                text: `✅ *Order Placed!*

🍽 ${item.name}
💰 Total: ₹${order.total}

🚚 Delivery soon!`
            });

            delete orderStates[sender];
            return;
        }

        // =========================================================
        // 🛒 START ORDER
        // =========================================================

        if (text.startsWith("order ")) {

            const name = text.replace("order ", "").trim();
            const menu = await getMenuFromApp();

            const item = menu.find(i =>
                i.name.toLowerCase().includes(name)
            );

            if (!item) {
                return await sock.sendMessage(sender, {
                    text: `❌ Item not found.\nType *menu*`
                });
            }

            orderStates[sender] = {
                step: 'WAITING_FOR_ADDRESS',
                item
            };

            const caption = `🛒 *Order Started*

🍽 ${item.name}
💰 ₹${item.price}

Send:
Name + Phone + Address`;

            if (item.imageUrl) {
                await sock.sendMessage(sender, {
                    image: { url: item.imageUrl },
                    caption
                });
            } else {
                await sock.sendMessage(sender, { text: caption });
            }

            return;
        }

        // =========================================================
        // 📋 MENU
        // =========================================================

        if (text.includes("menu")) {

            const menu = await getMenuFromApp();

            if (!menu.length) {
                return await sock.sendMessage(sender, {
                    text: "Menu empty"
                });
            }

            let msgText = "🍔 *MENU*\n\n";

            menu.forEach(i => {
                msgText += `🔹 ${i.name} - ₹${i.price}\n`;
            });

            msgText += "\nType: order pizza";

            return await sock.sendMessage(sender, {
                text: msgText
            });
        }

        // =========================================================
        // 👋 GREETING WITH IMAGE + BUTTONS
        // =========================================================

        if (text.includes("hi") || text.includes("hello") || text.includes("hey")) {

            const profileImage = "https://i.imgur.com/yourimage.jpg"; // 🔁 CHANGE

            return await sock.sendMessage(sender, {
                image: { url: profileImage },
                caption: `👋 *Welcome to My Portfolio*

I am *Kavinda* 🚀

Choose below 👇`,
                footer: "JavaGoat Assistant",
                buttons: [
                    { buttonId: 'about', buttonText: { displayText: '👤 About' }, type: 1 },
                    { buttonId: 'projects', buttonText: { displayText: '💻 Projects' }, type: 1 },
                    { buttonId: 'contact', buttonText: { displayText: '📞 Contact' }, type: 1 },
                    { buttonId: 'call', buttonText: { displayText: '📲 Call' }, type: 1 },
                    { buttonId: 'web', buttonText: { displayText: '🌐 Website' }, type: 1 }
                ],
                headerType: 4
            });
        }

        // =========================================================
        // ❓ DEFAULT
        // =========================================================

        await sock.sendMessage(sender, {
            text: `🤖 Type:
- menu
- order pizza
- hi`
        });

    });
}

startBot().catch(err => console.log(err));
