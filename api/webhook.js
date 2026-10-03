import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function sendMessage(senderId, text) {
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
          text,
        },
      }),
    }
  );

  const result = await response.json();
  console.log("Messenger reply result:", result);
}

export default async function handler(req, res) {
  // Messenger webhook verification
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

  // Messenger messages
  if (req.method === "POST") {
    const body = req.body;

    console.log("Messenger webhook event:", body);

    if (body.object === "page") {
      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          if (!event.message || !event.sender) {
            continue;
          }

          const senderId = event.sender.id;
          const messageText = event.message.text?.trim();

          console.log("Customer:", senderId);
          console.log("Message:", messageText);

          if (!messageText) {
            continue;
          }

          // Existing customer session
          let { data: session, error } = await supabase
            .from("messenger_sessions")
            .select("*")
            .eq("sender_id", senderId)
            .maybeSingle();

          if (error) {
            console.error("Supabase read error:", error);
            await sendMessage(
              senderId,
              "Уучлаарай, түр алдаа гарлаа. Та дахин оролдоно уу."
            );
            continue;
          }

          // New customer
          if (!session) {
            const { data: newSession, error: insertError } =
              await supabase
                .from("messenger_sessions")
                .insert({
                  sender_id: senderId,
                  step: "product"
                })
                .select()
                .single();

            if (insertError) {
              console.error(
                "Supabase insert error:",
                insertError
              );

              await sendMessage(
                senderId,
                "Уучлаарай, захиалгын системд түр алдаа гарлаа."
              );

              continue;
            }

            session = newSession;

            await sendMessage(
              senderId,
              `Сайн байна уу 👋
Монгол металл хийцэд хандсанд баярлалаа.

Та ямар бүтээгдэхүүн захиалах вэ?

1️⃣ Металл цонх
2️⃣ Металл хаалга
3️⃣ Металл хаалт

Та 1, 2 эсвэл 3 гэж хариулна уу.`
            );

            continue;
          }

          // STEP 1 — Product
          if (session.step === "product") {
            let productType = null;

            if (messageText === "1") {
              productType = "Металл цонх";
            } else if (messageText === "2") {
              productType = "Металл хаалга";
            } else if (messageText === "3") {
              productType = "Металл хаалт";
            }

            if (!productType) {
              await sendMessage(
                senderId,
                "1, 2 эсвэл 3 гэсэн сонголтоос сонгоно уу."
              );
              continue;
            }

            await supabase
              .from("messenger_sessions")
              .update({
                product_type: productType,
                step: "size",
                updated_at: new Date().toISOString()
              })
              .eq("sender_id", senderId);

            await sendMessage(
              senderId,
              `${productType} сонголоо ✅

Өргөн × өндөр хэмжээг метрээр оруулна уу.

Жишээ:
1.5 × 1.2`
            );

            continue;
          }

          // STEP 2 — Size
          if (session.step === "size") {
            const numbers = messageText
              .replace(",", ".")
              .match(/\d+(?:\.\d+)?/g);

            if (!numbers || numbers.length < 2) {
              await sendMessage(
                senderId,
                "Хэмжээг зөв оруулна уу.

Жишээ: 1.5 × 1.2"
              );
              continue;
            }

            const width = Number(numbers[0]);
            const height = Number(numbers[1]);

            await supabase
              .from("messenger_sessions")
              .update({
                width,
                height,
                step: "quantity",
                updated_at: new Date().toISOString()
              })
              .eq("sender_id", senderId);

            await sendMessage(
              senderId,
              `Хэмжээ: ${width} × ${height} м ✅

Хэдэн ширхэг захиалах вэ?`
            );

            continue;
          }

          // STEP 3 — Quantity
          if (session.step === "quantity") {
            const quantity = parseInt(messageText);

            if (!Number.isInteger(quantity) || quantity <= 0) {
              await sendMessage(
                senderId,
                "Ширхэгийн тоог зөв оруулна уу. Жишээ: 2"
              );
              continue;
            }

            await supabase
              .from("messenger_sessions")
              .update({
                quantity,
                step: "name",
                updated_at: new Date().toISOString()
              })
              .eq("sender_id", senderId);

            await sendMessage(
              senderId,
              "Захиалга авахын тулд нэрээ оруулна уу."
            );

            continue;
          }

          // STEP 4 — Name
          if (session.step === "name") {
            await supabase
              .from("messenger_sessions")
              .update({
                customer_name: messageText,
                step: "phone",
                updated_at: new Date().toISOString()
              })
              .eq("sender_id", senderId);

            await sendMessage(
              senderId,
              "Утасны дугаараа оруулна уу."
            );

            continue;
          }

          // STEP 5 — Phone
          if (session.step === "phone") {
            await supabase
              .from("messenger_sessions")
              .update({
                phone: messageText,
                step: "address",
                updated_at: new Date().toISOString()
              })
              .eq("sender_id", senderId);

            await sendMessage(
              senderId,
              "Хаана суурилуулах вэ?\n\nЖишээ: Баянзүрх дүүрэг, 13-р хороолол"
            );

            continue;
          }

          // STEP 6 — Address
          if (session.step === "address") {
            const { data: updatedSession } = await supabase
              .from("messenger_sessions")
              .update({
                address: messageText,
                step: "completed",
                updated_at: new Date().toISOString()
              })
              .eq("sender_id", senderId)
              .select()
              .single();

            if (updatedSession) {
              const area =
                updatedSession.width *
                updatedSession.height *
                updatedSession.quantity;

              await sendMessage(
                senderId,
                `Захиалгын мэдээлэл ✅

Бүтээгдэхүүн: ${updatedSession.product_type}
Хэмжээ: ${updatedSession.width} × ${updatedSession.height} м
Тоо: ${updatedSession.quantity} ш
Нийт талбай: ${area.toFixed(2)} м²
Нэр: ${updatedSession.customer_name}
Утас: ${updatedSession.phone}
Байршил: ${updatedSession.address}

Манай ажилтан удахгүй тантай холбогдоно. Баярлалаа! 🙏`
              );
            }

            continue;
          }

          // Completed session
          if (session.step === "completed") {
            await sendMessage(
              senderId,
              "Таны захиалгын мэдээлэл бүртгэгдсэн байна ✅\nМанай ажилтан тантай удахгүй холбогдоно."
            );
          }
        }
      }
    }

    return res.status(200).send("EVENT_RECEIVED");
  }

  return res.status(405).send("Method Not Allowed");
}
