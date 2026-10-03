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
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recipient: {
          id: senderId
        },
        message: {
          text: text
        }
      })
    }
  );

  const result = await response.json();
  console.log("Messenger reply result:", result);
}

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

    return res.status(403).send("Forbidden");
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const body = req.body;

  console.log("Messenger webhook event:", body);

  if (body.object !== "page") {
    return res.status(200).send("EVENT_RECEIVED");
  }

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {

      if (!event.message || !event.sender) {
        continue;
      }

      const senderId = event.sender.id;
      const messageText = event.message.text
        ? event.message.text.trim()
        : "";

      if (!messageText) {
        continue;
      }

      console.log("Customer:", senderId);
      console.log("Message:", messageText);

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
          "Сайн байна уу 👋\n\n" +
          "Монгол металл хийцэд хандсанд баярлалаа.\n\n" +
          "Та ямар бүтээгдэхүүн захиалах вэ?\n\n" +
          "1. Металл цонх\n" +
          "2. Металл хаалга\n" +
          "3. Металл хаалт\n\n" +
          "Та 1, 2 эсвэл 3 гэж хариулна уу."
        );

        continue;
      }

      if (session.step === "product") {

        let productType = null;

        if (messageText === "1") {
          productType = "Металл цонх";
        }

        if (messageText === "2") {
          productType = "Металл хаалга";
        }

        if (messageText === "3") {
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
          productType +
          " сонголоо.\n\n" +
          "Өргөн × өндөр хэмжээг метрээр оруулна уу.\n\n" +
          "Жишээ: 1.5 × 1.2"
        );

        continue;
      }

      if (session.step === "size") {

        const numbers = messageText
          .replace(",", ".")
          .match(/\d+(?:\.\d+)?/g);

        if (!numbers || numbers.length < 2) {

          await sendMessage(
            senderId,
            "Хэмжээг зөв оруулна уу.\n\n" +
            "Жишээ: 1.5 × 1.2"
          );

          continue;
        }

        const width = Number(numbers[0]);
        const height = Number(numbers[1]);

        await supabase
          .from("messenger_sessions")
          .update({
            width: width,
            height: height,
            step: "quantity",
            updated_at: new Date().toISOString()
          })
          .eq("sender_id", senderId);

        await sendMessage(
          senderId,
          "Хэмжээ: " +
          width +
          " × " +
          height +
          " м.\n\n" +
          "Хэдэн ширхэг захиалах вэ?"
        );

        continue;
      }

      if (session.step === "quantity") {

        const quantity = parseInt(messageText, 10);

        if (!Number.isInteger(quantity) || quantity <= 0) {

          await sendMessage(
            senderId,
            "Ширхэгийн тоог зөв оруулна уу.\n\n" +
            "Жишээ: 2"
          );

          continue;
        }

        await supabase
          .from("messenger_sessions")
          .update({
            quantity: quantity,
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
          "Хаана суурилуулах вэ?\n\n" +
          "Жишээ: Баянзүрх дүүрэг, 13-р хороолол"
        );

        continue;
      }

      if (session.step === "address") {

        const { data: updatedSession, error: updateError } =
          await supabase
            .from("messenger_sessions")
            .update({
              address: messageText,
              step: "completed",
              updated_at: new Date().toISOString()
            })
            .eq("sender_id", senderId)
            .select()
            .single();

        if (updateError) {
          console.error(
            "Supabase update error:",
            updateError
          );

          await sendMessage(
            senderId,
            "Уучлаарай, захиалга хадгалахад алдаа гарлаа."
          );

          continue;
        }

        const area =
          updatedSession.width *
          updatedSession.height *
          updatedSession.quantity;

        await sendMessage(
          senderId,
          "Захиалгын мэдээлэл:\n\n" +
          "Бүтээгдэхүүн: " +
          updatedSession.product_type +
          "\n" +
          "Хэмжээ: " +
          updatedSession.width +
          " × " +
          updatedSession.height +
          " м\n" +
          "Тоо: " +
          updatedSession.quantity +
          " ш\n" +
          "Нийт талбай: " +
          area.toFixed(2) +
          " м²\n" +
          "Нэр: " +
          updatedSession.customer_name +
          "\n" +
          "Утас: " +
          updatedSession.phone +
          "\n" +
          "Байршил: " +
          updatedSession.address +
          "\n\n" +
          "Манай ажилтан удахгүй тантай холбогдоно. Баярлалаа!"
        );

        continue;
      }

      if (session.step === "completed") {

        await sendMessage(
          senderId,
          "Таны захиалгын мэдээлэл бүртгэгдсэн байна.\n\n" +
          "Манай ажилтан тантай удахгүй холбогдоно."
        );

        continue;
      }
    }
  }

  return res.status(200).send("EVENT_RECEIVED");
}
