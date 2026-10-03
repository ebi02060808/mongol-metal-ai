export default async function handler(req, res) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (
      mode === "subscribe" &&
      token === process.env.VERIFY_TOKEN
    ) {
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  }

  if (req.method === "POST") {
    const body = req.body;

    console.log("Messenger webhook event:", body);

    if (body.object === "page") {
      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          if (event.message && event.sender) {
            const senderId = event.sender.id;
            const messageText = event.message.text;

            console.log("Customer:", senderId);
            console.log("Message:", messageText);

            if (messageText) {
              const response = await fetch(
                `https://graph.facebook.com/v26.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    recipient: {
                      id: senderId,
                    },
                    message: {
                      text: "Сайн байна уу 👋 Монгол металл хийцэд хандсанд баярлалаа. Та металл хаалга эсвэл цонх захиалах уу?",
                    },
                  }),
                }
              );

              const result = await response.json();

              console.log("Messenger reply result:", result);
            }
          }
        }
      }
    }

    return res.status(200).send("EVENT_RECEIVED");
  }

  return res.status(405).send("Method Not Allowed");
}
