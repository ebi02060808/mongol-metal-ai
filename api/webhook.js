import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const priceList = {
  "Металл цонх, давхар шилтэй": 420000,
  "Металл хаалга, давхар шилтэй": 840000,
  "Хуванцар хаалт, дан шилтэй": 160000,
  "Хуванцар цонх, 2 давхар шилтэй": 180000,
  "Хуванцар хаалга, 2 давхар шилтэй": 220000,
  "Металл фасад": 330000,
  "Шилэн фасад, хатаалгатай, 2 давхар шилтэй": 580000
};

const products = {
  "1": "Металл цонх, давхар шилтэй",
  "2": "Металл хаалга, давхар шилтэй",
  "3": "Хуванцар хаалт, дан шилтэй",
  "4": "Хуванцар цонх, 2 давхар шилтэй",
  "5": "Хуванцар хаалга, 2 давхар шилтэй",
  "6": "Металл фасад",
  "7": "Шилэн фасад, хатаалгатай, 2 давхар шилтэй"
};

function createOrderNumber() {
  const now = new Date();

  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ulaanbaatar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now).replace(/-/g, "");

  const randomPart = Math.floor(1000 + Math.random() * 9000);

  return "MP-" + date + "-" + randomPart;
}

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

  if (!response.ok) {
    console.error("Messenger send error:", result);
  }

  return result;
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
  order_id: randomUUID(),
  order_number: createOrderNumber(),
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
  "1. Металл цонх, давхар шилтэй — 420,000₮/м²\n" +
  "2. Металл хаалга, давхар шилтэй — 840,000₮/м²\n" +
  "3. Хуванцар хаалт, дан шилтэй — 160,000₮/м²\n" +
  "4. Хуванцар цонх, 2 давхар шилтэй — 180,000₮/м²\n" +
  "5. Хуванцар хаалга, 2 давхар шилтэй — 220,000₮/м²\n" +
  "6. Металл фасад — 330,000₮/м²\n" +
  "7. Шилэн фасад, хатаалгатай, 2 давхар шилтэй — 580,000₮/м²\n\n" +
  "Та 1–7 хүртэлх сонголтын дугаараа илгээнэ үү."
);

continue;
      }
    
      // Шинэ захиалга эхлүүлэх команд
      if (
        messageText.toLowerCase() === "шинэ захиалга" ||
        messageText.toLowerCase() === "shine zahialga" ||
        messageText.toLowerCase() === "дахиад захиалга өгөе" ||
        messageText.toLowerCase() === "dahiad zahialga uguy" ||
        messageText.toLowerCase() === "zahialga uguy"
      ) {

        const { error: resetError } = await supabase
          .from("messenger_sessions")
          .update({
            product_type: null,
            width: null,
            height: null,
            quantity: null,
            area: null,
            customer_name: null,
            phone: null,
            address: null,
            order_id: randomUUID(),
            order_number: createOrderNumber(),
            step: "product",
            updated_at: new Date().toISOString()
          })
          .eq("sender_id", senderId);

        if (resetError) {
          console.error("New order reset error:", resetError);

          await sendMessage(
            senderId,
            "Уучлаарай, шинэ захиалга эхлүүлэхэд алдаа гарлаа. Дахин оролдоно уу."
          );

          continue;
        }


await sendMessage(
  senderId,
  "🛠️ Шинэ захиалга эхэллээ!\n\n" +
  "Та ямар бүтээгдэхүүн захиалах вэ?\n\n" +
  "1. Металл цонх, давхар шилтэй — 420,000₮/м²\n" +
  "2. Металл хаалга, давхар шилтэй — 840,000₮/м²\n" +
  "3. Хуванцар хаалт, дан шилтэй — 160,000₮/м²\n" +
  "4. Хуванцар цонх, 2 давхар шилтэй — 180,000₮/м²\n" +
  "5. Хуванцар хаалга, 2 давхар шилтэй — 220,000₮/м²\n" +
  "6. Металл фасад — 330,000₮/м²\n" +
  "7. Шилэн фасад, хатаалгатай, 2 давхар шилтэй — 580,000₮/м²\n\n" +
  "Та 1–7 хүртэлх сонголтын дугаараа илгээнэ үү."
);

continue;
      }

    if (session.step === "product") {

  const products = {
    "1": "Металл цонх, давхар шилтэй",
    "2": "Металл хаалга, давхар шилтэй",
    "3": "Хуванцар хаалт, дан шилтэй",
    "4": "Хуванцар цонх, 2 давхар шилтэй",
    "5": "Хуванцар хаалга, 2 давхар шилтэй",
    "6": "Металл фасад",
    "7": "Шилэн фасад, хатаалгатай, 2 давхар шилтэй"
  };

  const productType = products[messageText];

if (!productType) {
  await sendMessage(
    senderId,
    "1–7 хүртэлх сонголтын дугаараас сонгоно уу."
  );
  continue;
}

const isFacade =
  productType === "Металл фасад" ||
  productType === "Шилэн фасад, хатаалгатай, 2 давхар шилтэй";

const { error: productUpdateError } = await supabase
  .from("messenger_sessions")
  .update({
    product_type: productType,
    width: null,
    height: null,
    quantity: null,
    area: null,
    step: isFacade ? "area" : "size",
    updated_at: new Date().toISOString()
  })
  .eq("sender_id", senderId);

if (productUpdateError) {
  console.error("Product update error:", productUpdateError);
  await sendMessage(senderId, "Бүтээгдэхүүн сонгоход алдаа гарлаа. Дахин оролдоно уу.");
  continue;
}

if (isFacade) {
  await sendMessage(
    senderId,
    productType +
    " сонголоо.\n\n" +
    "Нийт хэдэн м² талбай вэ?\n\n" +
    "Жишээ: 25"
  );
} else {
  await sendMessage(
    senderId,
    productType +
    " сонголоо.\n\n" +
    "Өргөн × өндөр хэмжээг метрээр оруулна уу.\n\n" +
    "Жишээ: 1.5 × 1.2"
  );
}

continue;
}
if (session.step === "area") {
  const enteredArea = Number(messageText.trim().replace(",", "."));

  if (!Number.isFinite(enteredArea) || enteredArea <= 0) {
    await sendMessage(
      senderId,
      "Талбайгаа зөв оруулна уу.\n\nЖишээ: 25 эсвэл 25.5"
    );
    continue;
  }

  const unitPrice = priceList[session.product_type];

  if (!unitPrice) {
    await sendMessage(senderId, "Бүтээгдэхүүний үнэ олдсонгүй. Дахин эхлүүлнэ үү.");
    continue;
  }

  const totalPrice = Math.round(enteredArea * unitPrice);

  const { error: itemError } = await supabase
    .from("messenger_order_items")
    .insert({
      order_id: session.order_id,
      sender_id: senderId,
      product_type: session.product_type,
      width: null,
      height: null,
      quantity: 1,
      unit_price: unitPrice,
      area: enteredArea,
      total_price: totalPrice
    });

  if (itemError) {
    console.error("Facade item insert error:", itemError);
    await sendMessage(senderId, "Захиалгын мэдээлэл хадгалахад алдаа гарлаа. Дахин оролдоно уу.");
    continue;
  }

  const { error: sessionError } = await supabase
    .from("messenger_sessions")
    .update({
      area: enteredArea,
      quantity: 1,
      step: "add_more",
      updated_at: new Date().toISOString()
    })
    .eq("sender_id", senderId);

  if (sessionError) {
    console.error("Facade session update error:", sessionError);
    await sendMessage(senderId, "Захиалгын төлөв хадгалахад алдаа гарлаа. Админтай холбогдоно уу.");
    continue;
  }

  await sendMessage(
    senderId,
    "📐 Нийт талбай: " + enteredArea.toFixed(2) + " м²\n" +
    "💰 Нэгж үнэ: " + unitPrice.toLocaleString("en-US") + "₮/м²\n" +
    "💵 Урьдчилсан үнэ: " + totalPrice.toLocaleString("en-US") + "₮\n\n" +
    "📷 Боломжтой бол фасад хийх объектын зураг илгээнэ үү.\n\n" +
    "Манай мэргэжилтэн объект дээр очиж бодит хэмжилт, нөхцөл байдлыг шалгасны дараа материал, хийц, угсралтын ажлыг тооцож, эцсийн үнийг харилцан тохиролцоно.\n\n" +
    "Анхаарна уу: Эцсийн үнэ нь бодит хэмжилт, объектын нөхцөлөөс хамаарч өөрчлөгдөж болно.\n\n" +
    "Өөр бүтээгдэхүүн эсвэл өөр хэмжээ нэмэх үү?\n\n" +
    "1 — Тийм, нэмэх\n" +
    "2 — Үгүй, захиалгаа дуусгах"
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

  const quantity = Number(messageText);

  if (!Number.isInteger(quantity) || quantity <= 0) {
    await sendMessage(
      senderId,
      "Ширхэгийн тоог зөв оруулна уу.\n\nЖишээ: 2"
    );
    continue;
  }

  const unitPrice = priceList[session.product_type];
  const area = session.width * session.height * quantity;
  const totalPrice = Math.round(area * unitPrice);

  if (!unitPrice || !session.order_id) {
    await sendMessage(
      senderId,
      "Захиалгын мэдээлэл дутуу байна. Шинэ захиалга эхлүүлнэ үү."
    );
    continue;
  }

  const { error: itemError } = await supabase
    .from("messenger_order_items")
    .insert({
      order_id: session.order_id,
      sender_id: senderId,
      product_type: session.product_type,
      width: session.width,
      height: session.height,
      quantity: quantity,
      unit_price: unitPrice,
      area: session.width * session.height,
      total_price: totalPrice
    });

  if (itemError) {
    console.error("Order item insert error:", itemError);

    await sendMessage(
      senderId,
      "Захиалгын мөр хадгалахад алдаа гарлаа. Дахин оролдоно уу."
    );
    continue;
  }

  const { error: updateError } = await supabase
    .from("messenger_sessions")
    .update({
      quantity: quantity,
      step: "add_more",
      updated_at: new Date().toISOString()
    })
    .eq("sender_id", senderId);

  if (updateError) {
    console.error("Session update error:", updateError);

    await sendMessage(
      senderId,
      "Захиалгын мэдээлэл шинэчлэхэд алдаа гарлаа."
    );
    continue;
  }

  await sendMessage(
    senderId,
    "✅ Бүтээгдэхүүн захиалгад нэмэгдлээ!\n\n" +
    "Бүтээгдэхүүн: " + session.product_type + "\n" +
    "Хэмжээ: " + session.width + " × " + session.height + " м\n" +
    "Тоо: " + quantity + " ш\n" +
    "Үнэ: " + totalPrice.toLocaleString("en-US") + "₮\n\n" +
    "Өөр бүтээгдэхүүн эсвэл өөр хэмжээ нэмэх үү?\n\n" +
    "1 — Тийм, нэмэх\n" +
    "2 — Үгүй, захиалгаа дуусгах"
  );

  continue;
}

if (session.step === "add_more") {

  if (messageText === "1") {
    await supabase
      .from("messenger_sessions")
      .update({
  product_type: null,
  width: null,
  height: null,
  quantity: null,
  area: null,
  step: "product",
  updated_at: new Date().toISOString()
})
      .eq("sender_id", senderId);

    await sendMessage(
      senderId,
      "Дараагийн бүтээгдэхүүн эсвэл өөр хэмжээгээ сонгоно уу.\n\n" +
      "1. Металл цонх — 420,000₮/м²\n" +
      "2. Металл хаалга — 840,000₮/м²\n" +
      "3. Хуванцар хаалт — 160,000₮/м²\n" +
      "4. Хуванцар цонх — 180,000₮/м²\n" +
      "5. Хуванцар хаалга — 220,000₮/м²\n" +
      "6. Металл фасад — 330,000₮/м²\n" +
      "7. Шилэн фасад — 580,000₮/м²"
    );

    continue;
  }

  if (messageText === "2") {
    await supabase
      .from("messenger_sessions")
      .update({
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

  await sendMessage(
    senderId,
    "1 — Өөр бүтээгдэхүүн эсвэл хэмжээ нэмэх\n" +
    "2 — Захиалгаа дуусгах гэж сонгоно уу."
  );

  continue;
}

if (session.step === "name") {
  const customerName = messageText.trim();

if (!/^[\p{L}][\p{L}\s'-]{1,49}$/u.test(customerName) ||
    (customerName.match(/\p{L}/gu) || []).length < 2) {

  await sendMessage(
    senderId,
    "Нэрээ зөв оруулна уу.\nЖишээ: Бат-Эрдэнэ"
  );
  continue;
}


        await supabase
          .from("messenger_sessions")
          .update({
           customer_name: customerName,
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

  const phoneNumber = messageText.replace(/[\s-]/g, "");
  const normalizedPhone = phoneNumber.replace(/^\+?976/, "");

  if (!/^[0-9]{8}$/.test(normalizedPhone)) {
    await sendMessage(
      senderId,
      "Утасны дугаараа зөв оруулна уу.\nЖишээ: 99112233"
    );
    continue;
  }

  const { error: phoneError } = await supabase
    .from("messenger_sessions")
    .update({
      phone: normalizedPhone,
      step: "address",
      updated_at: new Date().toISOString()
    })
    .eq("sender_id", senderId);

  if (phoneError) {
    console.error("Phone update error:", phoneError);
    await sendMessage(senderId, "Утас хадгалахад алдаа гарлаа. Дахин оролдоно уу.");
    continue;
  }

  await sendMessage(
    senderId,
    "Хаана суурилуулах вэ?\n\n" +
    "Жишээ: Баянзүрх дүүрэг, 13-р хороолол"
  );

  continue;
}

     
if (session.step === "address") {
  const customerAddress = messageText.trim();

if (
  customerAddress.length < 5 ||
  (customerAddress.match(/\p{L}/gu) || []).length < 4
) {
  await sendMessage(
    senderId,
    "Байршлаа дэлгэрэнгүй оруулна уу.\n\n" +
    "Жишээ: Баянзүрх дүүрэг, 13-р хороолол, 5-р байр."
  );
  continue;
}

  const { data: updatedSession, error: updateError } =
    await supabase
      .from("messenger_sessions")
      .update({
      address: customerAddress,
      step: "confirm",
      updated_at: new Date().toISOString()
      })
      .eq("sender_id", senderId)
      .select()
      .single();

  if (updateError) {
    console.error("Supabase update error:", updateError);

    await sendMessage(
      senderId,
      "Уучлаарай, захиалга хадгалахад алдаа гарлаа."
    );
    continue;
  }

  const { data: items, error: itemsError } = await supabase
    .from("messenger_order_items")
    .select("*")
    .eq("order_id", updatedSession.order_id)
    .order("created_at", { ascending: true });

  if (itemsError || !items || items.length === 0) {
    console.error("Order items fetch error:", itemsError);

    await sendMessage(
      senderId,
      "Захиалгын бүтээгдэхүүний мэдээлэл олдсонгүй. Дахин шалгуулна уу."
    );
    continue;
  }

let totalPrice = 0;
let totalArea = 0;
let itemDetails = "";

items.forEach((item, index) => {
  const itemArea = Number(item.area) * Number(item.quantity);
  const itemTotal = Number(item.total_price);

  totalArea += itemArea;
  totalPrice += itemTotal;

  const isFacade = item.width == null || item.height == null;

  const measurementDetails = isFacade
    ? "Нийт талбай: " + itemArea.toFixed(2) + " м²\n"
    : "Хэмжээ: " + item.width + " × " + item.height + " м\n" +
      "Тоо: " + item.quantity + " ш\n" +
      "Нийт талбай: " + itemArea.toFixed(2) + " м²\n";

  itemDetails +=
    (index + 1) + ". " + item.product_type + "\n" +
    measurementDetails +
    "Нэгж үнэ: " + Number(item.unit_price).toLocaleString("en-US") + "₮/м²\n" +
    "Дүн: " + itemTotal.toLocaleString("en-US") + "₮\n\n";
});
  await sendMessage(
    senderId,
    "📋 ТАНЫ ЗАХИАЛГЫН МЭДЭЭЛЭЛ\n\n" +
    "Захиалгын дугаар: " + updatedSession.order_number + "\n\n" +
    itemDetails +
    "--------------------\n" +
    "Нийт бүтээгдэхүүн: " + items.length + " мөр\n" +
    "Нийт талбай: " + totalArea.toFixed(2) + " м²\n" +
    "НИЙТ ТӨЛБӨР: " + totalPrice.toLocaleString("en-US") + "₮\n\n" +
    "Нэр: " + updatedSession.customer_name + "\n" +
    "Утас: " + updatedSession.phone + "\n" +
    "Байршил: " + updatedSession.address + "\n\n" +
    "Захиалгаа баталгаажуулах уу?\n\n" +
    "1️⃣ — Баталгаажуулах\n" +
    "2️⃣ — Буцах"
  );

  continue;
}


if (session.step === "confirm") {

  // 2 — Захиалгыг шинээр эхлүүлэх
  if (messageText === "2") {

    const { error: deleteError } = await supabase
      .from("messenger_order_items")
      .delete()
      .eq("order_id", session.order_id);

    if (deleteError) {
      console.error("Order items delete error:", deleteError);

      await sendMessage(
        senderId,
        "Захиалгыг шинэчлэхэд алдаа гарлаа. Дахин оролдоно уу."
      );
      continue;
    }

    const { error: resetError } = await supabase
      .from("messenger_sessions")
.update({
  order_id: randomUUID(),
  order_number: createOrderNumber(),
  product_type: null,
        width: null,
        height: null,
        quantity: null,
        area: null,
        customer_name: null,
        phone: null,
        address: null,
        step: "product",
        updated_at: new Date().toISOString()
      })
      .eq("sender_id", senderId);

    if (resetError) {
      console.error("Order reset error:", resetError);

      await sendMessage(
        senderId,
        "Захиалгыг дахин эхлүүлэхэд алдаа гарлаа."
      );
      continue;
    }

    await sendMessage(
      senderId,
      "Шинэ захиалга эхэллээ. Бүтээгдэхүүнээ сонгоно уу.\n\n" +
      "1. Металл цонх — 420,000₮/м²\n" +
      "2. Металл хаалга — 840,000₮/м²\n" +
      "3. Хуванцар хаалт — 160,000₮/м²\n" +
      "4. Хуванцар цонх — 180,000₮/м²\n" +
      "5. Хуванцар хаалга — 220,000₮/м²\n" +
      "6. Металл фасад — 330,000₮/м²\n" +
      "7. Шилэн фасад — 580,000₮/м²"
    );

    continue;
  }

  // 1 — Захиалгыг баталгаажуулах
  if (messageText !== "1") {
    await sendMessage(
      senderId,
      "1 — Баталгаажуулах\n2 — Захиалгаа шинээр эхлүүлэх гэж сонгоно уу."
    );
    continue;
  }

  const { data: items, error: itemsError } = await supabase
    .from("messenger_order_items")
    .select("*")
    .eq("order_id", session.order_id)
    .order("created_at", { ascending: true });

  if (itemsError || !items || items.length === 0) {
    console.error("Confirm items error:", itemsError);

    await sendMessage(
      senderId,
      "Захиалгын бүтээгдэхүүний мэдээлэл олдсонгүй. Дахин шалгуулна уу."
    );
    continue;
  }

  let totalPrice = 0;
  let totalArea = 0;
  let itemDetails = "";

 items.forEach((item, index) => {
  const itemArea = Number(item.area) * Number(item.quantity);
  const itemTotal = Number(item.total_price);

  totalArea += itemArea;
  totalPrice += itemTotal;

  const isFacade = item.width == null || item.height == null;

  const measurementDetails = isFacade
    ? "Нийт талбай: " + itemArea.toFixed(2) + " м²\n"
    : "Хэмжээ: " + item.width + " × " + item.height + " м\n" +
      "Тоо: " + item.quantity + " ш\n" +
      "Нийт талбай: " + itemArea.toFixed(2) + " м²\n";

  itemDetails +=
    (index + 1) + ". " + item.product_type + "\n" +
    measurementDetails +
    "Нэгж үнэ: " + Number(item.unit_price).toLocaleString("en-US") + "₮/м²\n" +
    "Дүн: " + itemTotal.toLocaleString("en-US") + "₮\n\n";
});

const { data: completedSession, error: completeError } =
  await supabase
    .from("messenger_sessions")
    .update({
      step: "completed",
      updated_at: new Date().toISOString()
    })
    .eq("sender_id", senderId)
    .eq("step", "confirm")
    .select("sender_id")
    .maybeSingle();

if (completeError) {
  console.error("Complete order error:", completeError);

  await sendMessage(
    senderId,
    "Захиалга баталгаажуулахад алдаа гарлаа."
  );
  continue;
}

if (!completedSession) {
  console.log("Order already confirmed:", session.order_number);
  continue;
}

  await sendMessage(
    process.env.ADMIN_PSID,
    "🔔 ШИНЭ ЗАХИАЛГА БАТАЛГААЖЛАА!\n\n" +
    "Захиалгын дугаар: " + session.order_number + "\n\n" +
    itemDetails +
    "--------------------\n" +
    "Нийт мөр: " + items.length + "\n" +
    "Нийт талбай: " + totalArea.toFixed(2) + " м²\n" +
    "НИЙТ ҮНЭ: " + totalPrice.toLocaleString("en-US") + "₮\n\n" +
    "Нэр: " + session.customer_name + "\n" +
    "Утас: " + session.phone + "\n" +
    "Байршил: " + session.address
  );

  await sendMessage(
    senderId,
    "✅ Таны захиалга амжилттай баталгаажлаа.\n\n" +
    "Захиалгын дугаар: " + session.order_number + "\n\n" +
    "Нийт бүтээгдэхүүн: " + items.length + " мөр\n" +
    "Нийт үнэ: " + totalPrice.toLocaleString("en-US") + "₮\n\n" +
    "Манай ажилтан удахгүй холбогдоно. Баярлалаа!"
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
