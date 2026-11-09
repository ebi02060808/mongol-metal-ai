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

// Messenger үнийн саналын мөнгөн дүнг Монгол форматтай харуулна.
function money(value) {
  return Math.round(Number(value || 0)).toLocaleString("mn-MN") + " ₮";
}

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

async function sendFileAttachment(senderId, fileBuffer, fileName) {
  // Эхлээд PDF-ийн бодит файлыг Messenger Attachment Upload API-д байршуулна.
  const form = new FormData();
  form.append(
    "message",
    JSON.stringify({
      attachment: {
        type: "file",
        payload: { is_reusable: true }
      }
    })
  );
  form.append(
    "filedata",
    new Blob([fileBuffer], { type: "application/pdf" }),
    fileName
  );

  const uploadResponse = await fetch(
    "https://graph.facebook.com/v26.0/me/message_attachments?access_token=" + process.env.PAGE_ACCESS_TOKEN,
    {
      method: "POST",
      body: form
    }
  );

  const uploadResult = await uploadResponse.json();
  console.log("Messenger PDF upload result:", uploadResult);

  if (!uploadResponse.ok || uploadResult.error || !uploadResult.attachment_id) {
    throw new Error(uploadResult.error?.message || "PDF Messenger-т байршуулагдсангүй");
  }

  const sendResponse = await fetch(
    "https://graph.facebook.com/v26.0/me/messages?access_token=" + process.env.PAGE_ACCESS_TOKEN,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: senderId },
        message: {
          attachment: {
            type: "file",
            payload: { attachment_id: uploadResult.attachment_id }
          }
        }
      })
    }
  );

  const sendResult = await sendResponse.json();
  console.log("Messenger PDF send result:", sendResult);

  if (!sendResponse.ok || sendResult.error) {
    throw new Error(sendResult.error?.message || "PDF Messenger-т илгээгдсэнгүй");
  }

  return sendResult;
}



async function buildMessengerQuotePdf(session, items, orderId) {
  const fontUrl = "https://cdn.jsdelivr.net/gh/notofonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Regular.ttf";
  const fontResponse = await fetch(fontUrl, { signal: AbortSignal.timeout(20000) });
  if (!fontResponse.ok) throw new Error("Монгол кирилл фонт татагдсангүй.");
  const fontBase64 = Buffer.from(await fontResponse.arrayBuffer()).toString("base64");
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  doc.addFileToVFS("NotoSans-Regular.ttf", fontBase64);
  doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
  doc.setFont("NotoSans", "normal");

  const margin = 15;
  const contentWidth = 180;
  const money = value => Math.round(Number(value || 0)).toLocaleString("mn-MN") + " ₮";
  const date = new Intl.DateTimeFormat("mn-MN", {
    timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
  let y = 20;
  doc.setFillColor(17, 24, 39);
  doc.rect(margin, y, contentWidth, 2, "F");
  y += 12;
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(18);
  doc.text("МОНГОЛ МЕТАЛЛ ХИЙЦ", margin, y);
  y += 7;
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text("Чанартай хийц, бат бөх суурилуулалт", margin, y);
  y += 10;
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(15);
  doc.text("ҮНИЙН САНАЛ", margin, y);
  y += 10;

  const details = [
    ["Захиалгын дугаар:", String(session.order_number || orderId)],
    ["Огноо:", date],
    ["Харилцагч:", String(session.customer_name || "—")],
    ["Утас:", String(session.phone || "—")],
    ["Байршил:", String(session.address || "—")]
  ];
  doc.setFontSize(9);
  for (const [label, value] of details) {
    doc.setTextColor(71, 85, 105);
    doc.text(label, margin, y);
    doc.setTextColor(17, 24, 39);
    const wrapped = doc.splitTextToSize(value, 135);
    doc.text(wrapped, margin + 32, y);
    y += Math.max(6, wrapped.length * 4.5);
  }
  y += 5;

  const cols = [
    { title: "№", x: margin, w: 8 },
    { title: "Бүтээгдэхүүн / хэмжээ", x: margin + 8, w: 82 },
    { title: "Тоо", x: margin + 90, w: 15 },
    { title: "Нэгж үнэ", x: margin + 105, w: 35 },
    { title: "Дүн", x: margin + 140, w: 40 }
  ];
  const drawHeader = () => {
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y - 5, contentWidth, 9, "F");
    doc.setFontSize(8);
    doc.setTextColor(17, 24, 39);
    for (const col of cols) doc.text(col.title, col.x + 1, y);
    y += 8;
  };
  drawHeader();

  let total = 0;
  let totalArea = 0;
  let hasNegotiable = false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const qty = Number(item.quantity || 1);
    const area = Number(item.area || 0) * qty;
    const negotiable = item.pricing_mode === "labor_only";
    const lineTotal = negotiable ? 0 : Number(item.total_price || 0);
    total += lineTotal;
    totalArea += area;
    hasNegotiable ||= negotiable;
    const measurement = item.width == null || item.height == null
      ? area.toFixed(2) + " м²"
      : Number(item.width) + " × " + Number(item.height) + " м";
    const productLines = doc.splitTextToSize(String(item.product_type || "Бүтээгдэхүүн") + "\n" + measurement, 78);
    const rowHeight = Math.max(10, productLines.length * 4.2 + 3);
    if (y + rowHeight > 275) {
      doc.addPage();
      y = 20;
      drawHeader();
    }
    doc.setFontSize(8);
    doc.setTextColor(17, 24, 39);
    doc.text(String(i + 1), cols[0].x + 1, y);
    doc.text(productLines, cols[1].x + 1, y);
    doc.text(String(qty), cols[2].x + 1, y);
    doc.text(negotiable ? "Тохирно" : money(item.unit_price) + "/м²", cols[3].x + 1, y);
    doc.text(negotiable ? "Тохирно" : money(lineTotal), cols[4].x + 1, y);
    y += rowHeight;
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y - 2, 195, y - 2);
  }
  if (y > 265) { doc.addPage(); y = 20; }
  y += 7;
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text("Нийт талбай: " + totalArea.toFixed(2) + " м²", margin, y);
  y += 7;
  doc.setFontSize(12);
  doc.setTextColor(17, 24, 39);
  doc.text("НИЙТ ДҮН: " + (hasNegotiable ? money(total) + " + ажлын хөлс тохиролцоно" : money(total)), margin, y);
  y += 12;
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  const note = "Тайлбар: Энэхүү үнийн санал нь урьдчилсан тооцоо бөгөөд бодит хэмжилт, объектын нөхцөл, материалын сонголтоос хамаарч эцсийн үнэ өөрчлөгдөж болно.";
  doc.text(doc.splitTextToSize(note, contentWidth), margin, y);
  const pdf = Buffer.from(doc.output("arraybuffer"));
  if (pdf.length < 1000 || pdf.length > 3 * 1024 * 1024 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("PDF файлын хэмжээ эсвэл бүтэц буруу байна.");
  }
  return pdf;
}


async function sendOrderQuoteDetails(senderId, orderId) {
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, user_id, customer_name, phone, product, size, price, quantity, area_per_unit, quote_items, quote_pdf_path, messenger_order_number, messenger_sender_id")
    .eq("id", orderId)
    .eq("messenger_sender_id", senderId)
    .maybeSingle();

  if (error || !order) {
    console.error("Messenger quote order lookup error:", error);
    await sendMessage(senderId, "Уучлаарай, үнийн саналын мэдээлэл олдсонгүй. Манай ажилтантай холбогдоно уу.");
    return;
  }

  const items = Array.isArray(order.quote_items) ? order.quote_items : [];
  let totalArea = 0;
  let fixedTotal = 0;
  const hasNegotiable = items.some(item => item.pricing_mode === "labor_only");
  const lines = items.length ? items.map((item, index) => {
    const quantity = Math.max(1, Number(item.quantity || 1));
    const area = Number(item.area || 0) * quantity;
    const negotiable = item.pricing_mode === "labor_only";
    const lineTotal = negotiable ? 0 : Number(item.total_price || 0);
    totalArea += area;
    fixedTotal += lineTotal;
    const measurement = item.width != null && item.height != null
      ? "Хэмжээ: " + item.width + " × " + item.height + " м, " + quantity + " ш"
      : "Талбай: " + area.toLocaleString("mn-MN", { maximumFractionDigits: 2 }) + " м²";
    return (index + 1) + ". " + (item.product_type || "Бүтээгдэхүүн") + "\n" +
      measurement + "\n" +
      (negotiable
        ? "Ажлын хөлс: Харилцан тохиролцоно"
        : "Нэгж үнэ: " + money(item.unit_price) + "/м²\nДүн: " + money(lineTotal));
  }) : [
    (order.product || "Бүтээгдэхүүн") + "\nХэмжээ: " + (order.size || "—") +
    "\nДүн: " + (order.price == null ? "Үнийг тохиролцоно" : money(order.price))
  ];

  if (!items.length) {
    totalArea = Number(order.area_per_unit || parseAreaFromSize(order.size) || 0) * Number(order.quantity || 1);
    fixedTotal = order.price == null ? 0 : Number(order.price);
  }

  const total = hasNegotiable
    ? (fixedTotal > 0 ? money(fixedTotal) + " + ажлын хөлс тохиролцоно" : "Ажлын хөлсийг тохиролцоно")
    : money(items.length ? fixedTotal : order.price);
  const message =
    "📋 МОНГОЛ МЕТАЛЛ ХИЙЦ — ТАНЫ ҮНИЙН САНАЛ\n\n" +
    "Сайн байна уу, " + (order.customer_name || "хүндэт харилцагч") + " аа.\n" +
    "Захиалгын дугаар: " + (order.messenger_order_number || order.id) + "\n\n" +
    lines.join("\n\n") + "\n\n" +
    "Нийт талбай: " + totalArea.toLocaleString("mn-MN", { maximumFractionDigits: 2 }) + " м²\n" +
    "НИЙТ ДҮН: " + total + "\n\n" +
    "Нэмэлт зүйл тодруулах бол энэ чатанд бичээрэй. Баярлалаа!";
  await sendMessage(senderId, message);

  // PDF өмнө нь хадгалагдсан бол эхлээд ашиглана. Байхгүй/уншигдахгүй бол захиалгын
  // мөрүүдээс шинээр үүсгэж Storage-д хадгалаад Messenger-ээр илгээнэ.
  let pdfBuffer = null;
  if (order.quote_pdf_path) {
    const { data: existingPdf, error: existingPdfError } = await supabase.storage
      .from("quote-pdfs")
      .download(order.quote_pdf_path);
    if (existingPdf && !existingPdfError) {
      pdfBuffer = Buffer.from(await existingPdf.arrayBuffer());
    } else {
      console.warn("Stored quote PDF unavailable; regenerating:", existingPdfError?.message);
    }
  }

  if (!pdfBuffer) {
    try {
      let pdfItems = items;
      if (!pdfItems.length) {
        const sizeMatch = String(order.size || "").match(/(\d+(?:[.,]\d+)?)\s*[×x*]\s*(\d+(?:[.,]\d+)?)/i);
        const width = sizeMatch ? Number(sizeMatch[1].replace(",", ".")) : null;
        const height = sizeMatch ? Number(sizeMatch[2].replace(",", ".")) : null;
        const area = Number(order.area_per_unit || (width && height ? width * height : 0));
        const quantity = Math.max(1, Number(order.quantity || 1));
        const totalPrice = order.price == null ? 0 : Number(order.price);
        pdfItems = [{
          product_type: order.product || "Бүтээгдэхүүн",
          width,
          height,
          area,
          quantity,
          unit_price: area > 0 ? totalPrice / (area * quantity) : totalPrice,
          total_price: totalPrice,
          pricing_mode: "materials_included"
        }];
      }

      pdfBuffer = await buildMessengerQuotePdf({
        order_number: order.messenger_order_number || order.id,
        customer_name: order.customer_name,
        phone: order.phone,
      }, pdfItems, order.id);

      const pdfPath = order.quote_pdf_path ||
        String(order.user_id) + "/dashboard-messenger-" + String(order.id) + ".pdf";
      const { error: uploadError } = await supabase.storage
        .from("quote-pdfs")
        .upload(pdfPath, pdfBuffer, {
          contentType: "application/pdf",
          upsert: true
        });
      if (uploadError) throw uploadError;

      const { error: pathUpdateError } = await supabase
        .from("orders")
        .update({ quote_pdf_path: pdfPath })
        .eq("id", order.id)
        .eq("messenger_sender_id", senderId);
      if (pathUpdateError) throw pathUpdateError;
      order.quote_pdf_path = pdfPath;
      console.log("Generated and stored Messenger quote PDF:", { orderId: order.id, pdfPath });
    } catch (pdfCreateError) {
      console.error("Messenger quote PDF generation/storage error:", pdfCreateError);
      await sendMessage(senderId, "Үнийн саналын мэдээлэл илгээгдлээ. PDF-г автоматаар үүсгэхэд алдаа гарлаа. Манай ажилтан шалгаж илгээнэ.");
      return;
    }
  }

  if (pdfBuffer.length < 1000 || pdfBuffer.subarray(0, 5).toString("ascii") !== "%PDF-" ||
      pdfBuffer.length > 3 * 1024 * 1024) {
    console.error("Dashboard quote PDF validation failed:", { size: pdfBuffer.length });
    await sendMessage(senderId, "Үнийн саналын PDF файлын бүтэц эсвэл хэмжээ буруу байна. Манай ажилтан шалгаж илгээнэ.");
    return;
  }

  try {
    await sendFileAttachment(
      senderId,
      pdfBuffer,
      "Mongol-Metal-Quote-" + (order.messenger_order_number || order.id) + ".pdf"
    );
  } catch (pdfSendError) {
    console.error("Dashboard quote PDF Messenger send error:", pdfSendError);
    await sendMessage(senderId, "Үнийн саналын мэдээлэл илгээгдлээ. PDF файлыг Messenger-ээр хавсаргаж чадсангүй. Манай ажилтан шалгана.");
  }
}

async function sendQuotePdfQuestion(senderId, orderId) {
  const response = await fetch(
    "https://graph.facebook.com/v26.0/me/messages?access_token=" + process.env.PAGE_ACCESS_TOKEN,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: senderId },
        message: {
          text: "📄 Таны үнийн саналын PDF файл бэлэн боллоо. Messenger чатаар авах уу?",
          quick_replies: [
            { content_type: "text", title: "📄 PDF авах", payload: "GET_QUOTE_PDF:" + orderId },
            { content_type: "text", title: "Үгүй, баярлалаа", payload: "DECLINE_QUOTE_PDF:" + orderId }
          ]
        }
      })
    }
  );
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error?.message || "PDF сонголтын асуулт илгээгдсэнгүй.");
  return result;
}

async function saveMessengerPhoto(senderId, orderId, attachment) {
  const imageUrl = attachment.payload?.url;

  if (!imageUrl) {
    throw new Error("Зургийн URL олдсонгүй");
  }

  // URL болон домэйныг шалгах
  let parsedUrl;

  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    throw new Error("Зургийн URL буруу байна");
  }

  const host = parsedUrl.hostname.toLowerCase();

  const allowedHost =
    host === "lookaside.fbsbx.com" ||
    host === "platform-lookaside.fbsbx.com" ||
    host.endsWith(".fbcdn.net");

  if (
    parsedUrl.protocol !== "https:" ||
    !allowedHost ||
    parsedUrl.username ||
    parsedUrl.password ||
    (parsedUrl.port && parsedUrl.port !== "443")
  ) {
    throw new Error("Зургийн хаяг зөвшөөрөгдөөгүй");
  }

  // Redirect дагахгүй, хүсэлтийн хугацааг хязгаарлах
  const response = await fetch(parsedUrl.href, {
    redirect: "error",
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error("Зургийг татаж чадсангүй");
  }

  // Файлын форматыг шалгах
  const contentType = (response.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  const extensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  };

  if (!extensions[contentType]) {
    throw new Error("Зургийн формат зөвшөөрөгдөөгүй");
  }

  // 10 MB-аас хэтэрвэл татахгүй
  const maxSize = 10 * 1024 * 1024;
  const contentLength = Number(response.headers.get("content-length"));

  if (contentLength > maxSize) {
    throw new Error("Зургийн хэмжээ 10 MB-аас их байна");
  }

  if (!response.body) {
    throw new Error("Зургийн өгөгдөл олдсонгүй");
  }

  // Татаж байх явцдаа хэмжээг шалгах
  const reader = response.body.getReader();
  const chunks = [];
  let totalSize = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      totalSize += value.length;

      if (totalSize > maxSize) {
        await reader.cancel();
        throw new Error("Зургийн хэмжээ 10 MB-аас их байна");
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  const imageBuffer = Buffer.concat(chunks);

  const fileName =
    `${orderId}/${Date.now()}-${randomUUID()}.${extensions[contentType]}`;

  const { error } = await supabase.storage
    .from("messenger-photos")
    .upload(fileName, imageBuffer, {
      contentType,
      upsert: false
    });

  if (error) {
    throw error;
  }

  return fileName;
}


async function repeatCurrentQuestion(senderId, session) {
  const prompts = {
    product: "Та ямар бүтээгдэхүүн захиалах вэ?\n1. Металл цонх\n2. Металл хаалга\n3. Хуванцар хаалт\n4. Хуванцар цонх\n5. Хуванцар хаалга\n6. Металл фасад\n7. Шилэн фасад",
    facade_mode: "Фасадын ажлын төрлөө сонгоно уу:\n1 — Материалтай\n2 — Зөвхөн ажлын хөлс (үнийг тохиролцоно)",
    area: "Фасадын нийт талбай хэдэн м² вэ? Жишээ: 25 эсвэл 25.5",
    size: "Өргөн × өндрийг метрээр оруулна уу. Жишээ: 1.5 × 1.2",
    quantity: "Хэдэн ширхэг захиалах вэ? Жишээ: 2",
    add_more: "Өөр бүтээгдэхүүн нэмэх үү?\n1 — Тийм\n2 — Үгүй, дуусгах",
    name: "Захиалга авахын тулд нэрээ оруулна уу.",
    phone: "Утасны дугаараа оруулна уу.",
    location_type: "Та хаана байрлаж байна вэ?\n1. Улаанбаатар\n2. Орон нутаг",
    district: "Улаанбаатарын аль дүүрэг вэ?",
    province: "Та аль аймагт байрлаж байна вэ?",
    soum: "Та аль суманд байрлаж байна вэ?",
    confirm: "Захиалгаа баталгаажуулах уу?\n1 — Баталгаажуулах\n2 — Буцах",
    completed: "Таны захиалга бүртгэгдсэн байна. Манай ажилтан удахгүй холбогдоно."
  };
  if (prompts[session?.step]) await sendMessage(senderId, prompts[session.step]);
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

      if (!event.sender) {
        continue;
      }

      // Үнийн саналын PDF авах/татгалзах Messenger postback
      if (event.postback?.payload) {
        const payload = String(event.postback.payload);
        const pdfMatch = payload.match(/^GET_QUOTE_PDF:(\d+)$/);
        const declineMatch = payload.match(/^DECLINE_QUOTE_PDF:(\d+)$/);

        if (declineMatch) {
          await sendMessage(event.sender.id, "Баярлалаа. Үнийн саналын PDF илгээхгүй. Нэмэлт зүйл асуух бол энд бичээрэй. 😊");
          continue;
        }

        if (pdfMatch) {
          const requestedOrderId = Number(pdfMatch[1]);
          const { data: quoteOrder, error: quoteOrderError } = await supabase
            .from("orders")
            .select("id, quote_pdf_path, messenger_order_number")
            .eq("id", requestedOrderId)
            .eq("messenger_sender_id", event.sender.id)
            .maybeSingle();

          if (quoteOrderError || !quoteOrder?.quote_pdf_path) {
            console.error("Quote PDF lookup error:", quoteOrderError);
            await sendMessage(event.sender.id, "Уучлаарай, энэ захиалгын PDF файл олдсонгүй. Манай ажилтантай холбогдоно уу.");
            continue;
          }

          const { data: pdfFile, error: pdfDownloadError } = await supabase.storage
            .from("quote-pdfs")
            .download(quoteOrder.quote_pdf_path);

          if (pdfDownloadError || !pdfFile) {
            console.error("Quote PDF download error:", pdfDownloadError);
            await sendMessage(event.sender.id, "PDF файл хадгалагдсан сангаас уншигдсангүй. Манай ажилтантай холбогдоно уу.");
            continue;
          }

          const pdfBuffer = Buffer.from(await pdfFile.arrayBuffer());

          if (
            pdfBuffer.length < 8 ||
            pdfBuffer.subarray(0, 5).toString("ascii") !== "%PDF-" ||
            pdfBuffer.length > 3 * 1024 * 1024
          ) {
            console.error("Quote PDF file validation failed:", {
              size: pdfBuffer.length,
              signature: pdfBuffer.subarray(0, 5).toString("ascii")
            });
            await sendMessage(event.sender.id, "PDF файлын формат эсвэл хэмжээ буруу байна. Манай ажилтантай холбогдоно уу.");
            continue;
          }

          try {
            await sendFileAttachment(
              event.sender.id,
              pdfBuffer,
              "Mongol-Metal-Quote-" + (quoteOrder.messenger_order_number || quoteOrder.id) + ".pdf"
            );
          } catch (sendPdfError) {
            console.error("Quote PDF Messenger send error:", sendPdfError);
            await sendMessage(event.sender.id, "PDF файлыг Messenger-ээр илгээж чадсангүй. Манай ажилтан тантай холбогдоно.");
          }
          continue;
        }

        continue;
      }

      if (!event.message) {
        continue;
      }

     const senderId = event.sender.id;

// Dashboard-аас илгээсэн үнийн саналын асуултын quick reply.
const quoteChoicePayload = String(event.message.quick_reply?.payload || "");
const quoteYesMatch = quoteChoicePayload.match(/^SEND_ORDER_QUOTE:([A-Za-z0-9-]+)$/);
const quoteNoMatch = quoteChoicePayload.match(/^DECLINE_ORDER_QUOTE:([A-Za-z0-9-]+)$/);
if (quoteYesMatch) {
  await sendOrderQuoteDetails(senderId, quoteYesMatch[1]);
  continue;
}
if (quoteNoMatch) {
  await sendMessage(senderId, "Ойлголоо. Үнийн санал илгээхгүй. Хэрэгтэй үедээ энэ чатанд бичээрэй. 😊");
  continue;
}

const messageText = event.message.text
  ? event.message.text.trim()
  : "";

const attachments = event.message.attachments || [];

const hasImage = attachments.some(
  item => item.type === "image"
);

if (!messageText && !hasImage) {
  continue;
}

// Messenger зарим орчинд postback биш товчны гарчгийг энгийн текстээр дамжуулж болзошгүй.
// Ийм үед захиалгын дугаарыг payload-аас авахгүйгээр тухайн хэрэглэгчийн хамгийн сүүлийн PDF-ийг илгээнэ.
if (messageText === "📄 PDF авах") {
  const { data: latestQuote, error: latestQuoteError } = await supabase
    .from("orders")
    .select("id, quote_pdf_path, messenger_order_number")
    .eq("messenger_sender_id", senderId)
    .not("quote_pdf_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestQuoteError || !latestQuote?.quote_pdf_path) {
    console.error("Latest quote PDF lookup error:", latestQuoteError);
    await sendMessage(senderId, "Уучлаарай, таны үнийн саналын PDF файл олдсонгүй. Манай ажилтантай холбогдоно уу.");
    continue;
  }

  const { data: pdfFile, error: pdfDownloadError } = await supabase.storage
    .from("quote-pdfs")
    .download(latestQuote.quote_pdf_path);

  if (pdfDownloadError || !pdfFile) {
    console.error("Quote PDF download error:", pdfDownloadError);
    await sendMessage(senderId, "PDF файлыг хадгалсан сангаас уншиж чадсангүй. Манай ажилтан шалгаж өгнө.");
    continue;
  }

  const pdfBuffer = Buffer.from(await pdfFile.arrayBuffer());
  if (
    pdfBuffer.length < 8 ||
    pdfBuffer.subarray(0, 5).toString("ascii") !== "%PDF-" ||
    pdfBuffer.length > 3 * 1024 * 1024
  ) {
    console.error("Quote PDF validation failed:", { size: pdfBuffer.length });
    await sendMessage(senderId, "PDF файлын формат эсвэл хэмжээ буруу байна. Манай ажилтан шалгаж өгнө.");
    continue;
  }

  try {
    await sendFileAttachment(
      senderId,
      pdfBuffer,
      "Mongol-Metal-Quote-" + (latestQuote.messenger_order_number || latestQuote.id) + ".pdf"
    );
  } catch (sendPdfError) {
    console.error("Quote PDF Messenger send error:", sendPdfError);
    await sendMessage(senderId, "PDF файлыг Messenger-ээр илгээж чадсангүй. Манай ажилтан шалгаж өгнө.");
  }
  continue;
}

if (messageText === "Үгүй, баярлалаа") {
  await sendMessage(senderId, "Баярлалаа. PDF илгээхгүй. Нэмэлт зүйл асуух бол энд бичээрэй. 😊");
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

        // Шинэ хэрэглэгч анх зураг илгээсэн бол хадгалах
        if (hasImage) {
          for (const attachment of attachments) {
            if (attachment.type !== "image") continue;

            try {
              const fileName = await saveMessengerPhoto(
                senderId,
                session.order_id,
                attachment
              );

              console.log("Saved customer photo:", fileName);
              const { error: photoDbError } = await supabase
  .from("messenger_order_photos")
  .insert({
    order_id: session.order_id,
    sender_id: senderId,
    file_path: fileName
  });

if (photoDbError) {
  throw photoDbError;
}

              await sendMessage(
                senderId,
                "📷 Зураг амжилттай хадгалагдлаа.\n" +
                "Захиалгын дугаар: " + session.order_number
              );
            } catch (photoError) {
              console.error("Photo save error:", photoError);

              await sendMessage(
                senderId,
                "Зургийг хадгалахад алдаа гарлаа. JPG, PNG эсвэл WEBP зураг дахин илгээнэ үү."
              );
            }
          }
        }

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

// Зураг аль ч алхамд ирсэн тухайн захиалгад хадгална.
if (hasImage) {
  let savedCount = 0;
  for (const attachment of attachments) {
    if (attachment.type !== "image") continue;
    try {
      const fileName = await saveMessengerPhoto(senderId, session.order_id, attachment);
      const { error: photoDbError } = await supabase
        .from("messenger_order_photos")
        .insert({ order_id: session.order_id, sender_id: senderId, file_path: fileName });
      if (photoDbError) throw photoDbError;
      savedCount++;
      console.log("Saved customer photo:", fileName);
    } catch (photoError) {
      console.error("Photo save error:", photoError);
      await sendMessage(senderId, "Зургийг хадгалахад алдаа гарлаа. JPG, PNG эсвэл WEBP форматаар 10 MB-аас бага зураг дахин илгээнэ үү.");
    }
  }
  if (savedCount) {
    await sendMessage(senderId, "📷 Зураг амжилттай хадгалагдлаа. Захиалгын дугаар: " + session.order_number);
  }
  if (!messageText) {
    await repeatCurrentQuestion(senderId, session);
    continue;
  }
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
            pricing_mode: null,
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
    step: isFacade ? "facade_mode" : "size",
    updated_at: new Date().toISOString()
  })
  .eq("sender_id", senderId);

if (productUpdateError) {
  console.error("Product update error:", productUpdateError);
  await sendMessage(senderId, "Бүтээгдэхүүн сонгоход алдаа гарлаа. Дахин оролдоно уу.");
  continue;
}

if (isFacade) {
  await sendMessage(senderId,
    productType + " сонголоо.\n\n" +
    "Ажлын төрлөө сонгоно уу:\n\n" +
    "1 — Материалтай (материал + үйлдвэрлэл + угсралт)\n" +
    "2 — Зөвхөн ажлын хөлс (үнийг харилцан тохиролцоно)"
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
if (session.step === "facade_mode") {
  const choice = messageText.trim();
  if (choice !== "1" && choice !== "2") {
    await sendMessage(senderId, "1 — Материалтай\n2 — Зөвхөн ажлын хөлс (үнийг тохиролцоно)\n\n1 эсвэл 2 гэж сонгоно уу.");
    continue;
  }
  const pricingMode = choice === "1" ? "materials_included" : "labor_only";
  const { error: modeError } = await supabase
    .from("messenger_sessions")
    .update({ pricing_mode: pricingMode, step: "area", updated_at: new Date().toISOString() })
    .eq("sender_id", senderId);
  if (modeError) {
    console.error("Facade pricing mode update error:", modeError);
    await sendMessage(senderId, "Үнийн төрлийг хадгалахад алдаа гарлаа. Дахин сонгоно уу.");
    continue;
  }
  await sendMessage(senderId,
    (pricingMode === "materials_included"
      ? "✅ Материалтай ажлыг сонголоо. Жишиг үнэ: " + priceList[session.product_type].toLocaleString("mn-MN") + "₮/м²."
      : "✅ Зөвхөн ажлын хөлсийг сонголоо. Үнийг объектын нөхцөл, хэмжилтийн дараа харилцан тохиролцоно.") +
    "\n\nФасадын нийт талбай хэдэн м² вэ?\nЖишээ: 25 эсвэл 25.5"
  );
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

  const pricingMode = session.pricing_mode || "materials_included";
  const unitPrice = pricingMode === "labor_only" ? null : priceList[session.product_type];
  if (pricingMode !== "labor_only" && !unitPrice) {
    await sendMessage(senderId, "Бүтээгдэхүүний үнэ олдсонгүй. Дахин эхлүүлнэ үү.");
    continue;
  }
  const totalPrice = unitPrice == null ? null : Math.round(enteredArea * unitPrice);

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
      total_price: totalPrice,
      pricing_mode: pricingMode
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
    (pricingMode === "labor_only"
      ? "💰 Ажлын хөлс: Объектын нөхцөлтэй танилцсаны дараа харилцан тохиролцоно.\n\n"
      : "💰 Материалтай үнэ: " + unitPrice.toLocaleString("mn-MN") + "₮/м²\n" +
        "💵 Урьдчилсан үнэ: " + totalPrice.toLocaleString("mn-MN") + "₮\n\n") +
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
  const normalizedText = messageText.trim().replace(/,/g, ".");

  const match = normalizedText.match(
    /^(\d+(?:\.\d+)?)\s*[xх×*]\s*(\d+(?:\.\d+)?)$/i
  );

  if (!match) {
    await sendMessage(
      senderId,
      "Хэмжээг зөв оруулна уу.\n\n" +
      "Жишээ: 1.5 × 1.2\n" +
      "Эсвэл: 1.5x1.2"
    );
    continue;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  const pieceArea = width * height;

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 0.1 ||
    height < 0.1 ||
    width > 20 ||
    height > 20 ||
    pieceArea > 100
  ) {
    await sendMessage(
      senderId,
      "Оруулсан хэмжээ боломжит хязгаараас хэтэрсэн байна.\n\n" +
      "Өргөн, өндөр тус бүр 0.1–20 метр байх бөгөөд нэг ширхэгийн талбай 100 м²-ээс ихгүй байна.\n\n" +
      "Хэмжээгээ дахин шалгана уу."
    );
    continue;
  }

  const { error: sizeError } = await supabase
    .from("messenger_sessions")
    .update({
      width: width,
      height: height,
      step: "quantity",
      updated_at: new Date().toISOString()
    })
    .eq("sender_id", senderId);

  if (sizeError) {
    console.error("Size update error:", sizeError);
    await sendMessage(
      senderId,
      "Хэмжээ хадгалахад алдаа гарлаа. Дахин оруулна уу."
    );
    continue;
  }

  await sendMessage(
    senderId,
    "Хэмжээ: " + width + " × " + height + " м.\n" +
    "Нэг ширхэгийн талбай: " + pieceArea.toFixed(2) + " м²\n\n" +
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
  pricing_mode: null,
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

  if (
    !/^[\p{L}][\p{L}\s'-]{1,49}$/u.test(customerName) ||
    (customerName.match(/\p{L}/gu) || []).length < 2
  ) {
    await sendMessage(
      senderId,
      "Нэрээ зөв оруулна уу.\nЖишээ: Бат-Эрдэнэ"
    );
    continue;
  }

  const { error: nameError } = await supabase
    .from("messenger_sessions")
    .update({
      customer_name: customerName,
      step: "phone",
      updated_at: new Date().toISOString()
    })
    .eq("sender_id", senderId);

  if (nameError) {
    console.error("Name update error:", nameError);

    await sendMessage(
      senderId,
      "Нэр хадгалахад алдаа гарлаа. Дахин оруулна уу."
    );
    continue;
  }

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
      step: "location_type",
      updated_at: new Date().toISOString()
    })
    .eq("sender_id", senderId);

  if (phoneError) {
    console.error("Phone update error:", phoneError);
    await sendMessage(
      senderId,
      "Утас хадгалахад алдаа гарлаа. Дахин оролдоно уу."
    );
    continue;
  }

  await sendMessage(
    senderId,
    "Та хаана байрлаж байна вэ?\n\n" +
    "1. Улаанбаатар\n" +
    "2. Орон нутаг"
  );

  continue;
}


if (session.step === "location_type") {
  const choice = messageText.trim();

  if (choice === "1") {
    const { error } = await supabase
      .from("messenger_sessions")
      .update({
        address: null,
        step: "district",
        updated_at: new Date().toISOString()
      })
      .eq("sender_id", senderId);

    if (error) {
      console.error("Location type error:", error);
      await sendMessage(senderId, "Алдаа гарлаа. Дахин сонгоно уу.");
      continue;
    }

    await sendMessage(
      senderId,
      "Улаанбаатарын аль дүүрэг вэ?\n\nЖишээ: Баянзүрх дүүрэг"
    );
    continue;
  }

  if (choice === "2") {
  const { error } = await supabase
    .from("messenger_sessions")
    .update({
      address: null,
      province: null,
      step: "province",
      updated_at: new Date().toISOString()
    })
    .eq("sender_id", senderId);

  if (error) {
    console.error("Province step error:", error);
    await sendMessage(senderId, "Алдаа гарлаа. Дахин сонгоно уу.");
    continue;
  }

   await sendMessage(
  senderId,
  "Та аль аймагт байрлаж байна вэ?\n\nЖишээ: Өмнөговь аймаг"
);
    continue;
  }

  await sendMessage(
    senderId,
    "1. Улаанбаатар\n2. Орон нутаг\n\n1 эсвэл 2 гэж сонгоно уу."
  );
  continue;
}

if (session.step === "province") {
  const provinceName = messageText.trim();

  if ((provinceName.match(/\p{L}/gu) || []).length < 4) {
    await sendMessage(
      senderId,
      "Аймгийн нэрээ зөв оруулна уу.\nЖишээ: Өмнөговь аймаг"
    );
    continue;
  }

  const { error } = await supabase
    .from("messenger_sessions")
    .update({
      province: provinceName,
      step: "soum",
      updated_at: new Date().toISOString()
    })
    .eq("sender_id", senderId);

  if (error) {
    console.error("Province save error:", error);
    await sendMessage(senderId, "Аймаг хадгалахад алдаа гарлаа. Дахин оруулна уу.");
    continue;
  }

  await sendMessage(
    senderId,
    "Та аль суманд байрлаж байна вэ?\nЖишээ: Даланзадгад сум"
  );
  continue;
}

if (session.step === "district" || session.step === "soum") {
const locationDetail = messageText.trim();

const customerAddress =
  session.step === "soum"
    ? `${session.province}, ${locationDetail}`
    : locationDetail;
 if (
  customerAddress.length < 4 ||
  !/[\p{L}]{2,}/u.test(customerAddress)
) {
    await sendMessage(senderId, "Дүүрэг эсвэл сумын нэрээ зөв оруулна уу.");
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
  const isNegotiable = item.pricing_mode === "labor_only";
  const itemTotal = isNegotiable ? 0 : Number(item.total_price || 0);
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
    (isNegotiable
      ? "Ажлын хөлс: Харилцан тохиролцоно\n"
      : "Нэгж үнэ: " + Number(item.unit_price).toLocaleString("mn-MN") + "₮/м²\n" +
        "Дүн: " + itemTotal.toLocaleString("mn-MN") + "₮\n") + "\n";
});
  await sendMessage(
    senderId,
    "📋 ТАНЫ ЗАХИАЛГЫН МЭДЭЭЛЭЛ\n\n" +
    "Захиалгын дугаар: " + updatedSession.order_number + "\n\n" +
    itemDetails +
    "--------------------\n" +
    "Нийт бүтээгдэхүүн: " + items.length + " мөр\n" +
    "Нийт талбай: " + totalArea.toFixed(2) + " м²\n" +
    "НИЙТ ДҮН: " + (items.some(item => item.pricing_mode === "labor_only")
      ? (totalPrice > 0 ? totalPrice.toLocaleString("mn-MN") + "₮ + ажлын хөлс тохиролцоно" : "Ажлын хөлсийг тохиролцоно")
      : totalPrice.toLocaleString("mn-MN") + "₮") + "\n\n" +
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
        pricing_mode: null,
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
  const isNegotiable = item.pricing_mode === "labor_only";
  const itemTotal = isNegotiable ? 0 : Number(item.total_price || 0);
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
    (isNegotiable
      ? "Ажлын хөлс: Харилцан тохиролцоно\n"
      : "Нэгж үнэ: " + Number(item.unit_price).toLocaleString("mn-MN") + "₮/м²\n" +
        "Дүн: " + itemTotal.toLocaleString("mn-MN") + "₮\n") + "\n";
});

// Админ хэрэглэгчийн ID-г авах
const { data: admin, error: adminError } = await supabase
  .from("admin_users")
  .select("user_id")
  .eq("role", "admin")
  .limit(1)
  .maybeSingle();

if (adminError || !admin?.user_id) {
  console.error("Admin user lookup error:", adminError);

  await sendMessage(
    senderId,
    "Захиалгыг бүртгэхэд админы мэдээлэл олдсонгүй. Түр хүлээнэ үү."
  );
  continue;
}

// Захиалгын мэдээллийг нэгтгэх
const orderProduct = items
  .map(item => item.product_type)
  .join(", ");

const orderSize = items.map((item, index) => {
  const isFacade = item.width == null || item.height == null;

  const measurement = isFacade
    ? Number(item.area).toFixed(2) + " м²"
    : item.width + " × " + item.height + " м, " +
      item.quantity + " ш";

  return (index + 1) + ". " + measurement;
}).join("; ");

const orderStatus = "Шинэ захиалга - " + session.order_number;

// Давхар бүртгэл үүсэхээс хамгаалж шалгах
const { data: existingOrder, error: checkError } = await supabase
  .from("orders")
  .select("id, quote_pdf_path")
  .eq("status", orderStatus)
  .eq("user_id", admin.user_id)
  .maybeSingle();

if (checkError) {
  console.error("Existing order check error:", checkError);

  await sendMessage(
    senderId,
    "Захиалгыг шалгахад алдаа гарлаа. Дахин оролдоно уу."
  );
  continue;
}

// Өмнө бүртгэгдээгүй бол orders хүснэгтэд хадгалах
let savedOrder = null;
if (!existingOrder) {
  const { data: insertedOrder, error: saveOrderError } = await supabase
    .from("orders")
  .insert({
  customer_name: session.customer_name,
  phone: session.phone,
  product: orderProduct,
  size: orderSize,
  price: items.some(item => item.pricing_mode === "labor_only") ? null : totalPrice,
  area_per_unit: totalArea || 1,
  quantity: 1,
  unit_price: items.some(item => item.pricing_mode === "labor_only") || !totalArea ? null : Math.round(totalPrice / totalArea),
  status: orderStatus,
  user_id: admin.user_id,
  order_source: "messenger",
  messenger_sender_id: senderId,
  messenger_order_number: session.order_number,
  quote_items: items.map(item => ({
    product_type: item.product_type,
    width: item.width,
    height: item.height,
    quantity: item.quantity,
    area: item.area,
    unit_price: item.unit_price,
    total_price: item.total_price,
    pricing_mode: item.pricing_mode || "materials_included"
  }))
})
  .select("id, quote_pdf_path")
  .single();
  
  if (saveOrderError) {
    console.error("Save Messenger order error:", saveOrderError);

    await sendMessage(
      senderId,
      "Захиалгыг бүртгэхэд алдаа гарлаа. Манай ажилтан шалгаж холбогдоно."
    );
    continue;
  }
  savedOrder = insertedOrder;
}

// Үнийн саналын PDF-г үүсгэж хадгална. Давтан webhook-д ижил файл ашиглана.
let quotePdfReady = false;
const quoteOrderId = existingOrder?.id || savedOrder?.id;
const quoteFilePath = admin.user_id + "/messenger-" + session.order_id + ".pdf";
if (quoteOrderId) {
  let pdfPath = existingOrder?.quote_pdf_path || null;
  if (!pdfPath) {
    try {
      const pdfBuffer = await buildMessengerQuotePdf(session, items, quoteOrderId);
      const { error: pdfUploadError } = await supabase.storage
        .from("quote-pdfs")
        .upload(quoteFilePath, pdfBuffer, { contentType: "application/pdf", upsert: true });
      if (pdfUploadError) throw pdfUploadError;
      const { error: pdfPathError } = await supabase
        .from("orders")
        .update({ quote_pdf_path: quoteFilePath })
        .eq("id", quoteOrderId)
        .eq("user_id", admin.user_id);
      if (pdfPathError) throw pdfPathError;
      pdfPath = quoteFilePath;
    } catch (pdfBuildError) {
      console.error("Messenger quote PDF build/save error:", pdfBuildError);
      await sendMessage(senderId, "Захиалга бүртгэгдлээ. PDF үүсгэхэд түр алдаа гарлаа. Манай ажилтан PDF-г бэлдэж өгнө.");
    }
  }
  if (pdfPath) {
    quotePdfReady = true;
    try {
      await sendQuotePdfQuestion(senderId, quoteOrderId);
    } catch (questionError) {
      console.error("Messenger quote PDF question error:", questionError);
      await sendMessage(senderId, "Таны үнийн санал бэлэн боллоо. PDF авах бол 📄 PDF авах гэж бичнэ үү.");
    }
  }
}

// Захиалгыг баталгаажсан төлөвт шилжүүлэх
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
    "Захиалгын төлөв шинэчлэхэд алдаа гарлаа."
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
    "НИЙТ ДҮН: " + (items.some(item => item.pricing_mode === "labor_only")
      ? (totalPrice > 0 ? totalPrice.toLocaleString("mn-MN") + "₮ + ажлын хөлс тохиролцоно" : "Ажлын хөлсийг тохиролцоно")
      : totalPrice.toLocaleString("mn-MN") + "₮") + "\n\n" +
    "Нэр: " + session.customer_name + "\n" +
    "Утас: " + session.phone + "\n" +
    "Байршил: " + session.address
  );

  await sendMessage(
    senderId,
    "✅ Таны захиалга амжилттай баталгаажлаа.\n\n" +
    "Захиалгын дугаар: " + session.order_number + "\n\n" +
    "Нийт бүтээгдэхүүн: " + items.length + " мөр\n" +
    "Нийт үнэ: " + (items.some(item => item.pricing_mode === "labor_only")
      ? (totalPrice > 0 ? totalPrice.toLocaleString("mn-MN") + "₮ + ажлын хөлс тохиролцоно" : "Ажлын хөлсийг тохиролцоно")
      : totalPrice.toLocaleString("mn-MN") + "₮") + "\n\n" +
    "Манай ажилтан удахгүй холбогдоно. Баярлалаа!" + (quotePdfReady ? "\n\n📄 PDF авах бол дээрх товчийг дарна уу." : "")
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
