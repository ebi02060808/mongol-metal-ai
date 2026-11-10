import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("976") && digits.length > 8) digits = digits.slice(3);
  return digits;
}

function createOrderNumber(requestId) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ulaanbaatar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date()).replace(/-/g, "");
  return "MM-" + date + "-" + requestId.replace(/-/g, "").slice(0, 6).toUpperCase();
}

async function sendFileAttachment(senderId, fileBuffer, fileName) {
  const form = new FormData();
  form.append("message", JSON.stringify({
    attachment: { type: "file", payload: { is_reusable: true } }
  }));
  form.append("filedata", new Blob([fileBuffer], { type: "application/pdf" }), fileName);

  const uploadResponse = await fetch(
    "https://graph.facebook.com/v26.0/me/message_attachments?access_token=" + process.env.PAGE_ACCESS_TOKEN,
    { method: "POST", body: form }
  );
  const uploadResult = await uploadResponse.json();
  if (!uploadResponse.ok || uploadResult.error || !uploadResult.attachment_id) {
    throw new Error(uploadResult.error?.message || "PDF Messenger-т байршуулагдсангүй.");
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
  if (!sendResponse.ok || sendResult.error) {
    throw new Error(sendResult.error?.message || "PDF Messenger-ээр илгээгдсэнгүй.");
  }
  return sendResult;
}

function decodePdf(value) {
  const encoded = String(value || "");
  if (!encoded || encoded.length > 4_300_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("PDF файлын өгөгдөл буруу эсвэл хэт том байна.");
  }
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length < 1000 || buffer.length > 3 * 1024 * 1024 ||
      buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("PDF файл хоосон, буруу форматтай эсвэл 3 MB-аас их байна.");
  }
  return buffer;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST хүсэлт шаардлагатай." });
  }

  let createdOrderId = null;
  try {
    const accessToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!accessToken) return res.status(401).json({ error: "Нэвтрэх эрх олдсонгүй." });

    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user) return res.status(401).json({ error: "Нэвтрэлт хүчингүй байна." });

    const { data: member, error: memberError } = await supabase
      .from("admin_users")
      .select("role, owner_user_id, can_create_orders")
      .eq("user_id", user.id)
      .maybeSingle();
    if (memberError || !member || !["admin", "employee"].includes(member.role)) {
      return res.status(403).json({ error: "Админ эсвэл ажилтны эрх шаардлагатай." });
    }
    if (member.role !== "admin" && member.can_create_orders !== true) {
      return res.status(403).json({ error: "Үнийн санал захиалга болгох, Messenger-ээр илгээх захиалга үүсгэх эрхгүй байна." });
    }

    if (!process.env.PAGE_ACCESS_TOKEN) {
      return res.status(500).json({ error: "Messenger-ийн Page тохиргоо олдсонгүй." });
    }

    const ownerUserId = member.owner_user_id || user.id;
    const body = req.body || {};
    const requestId = String(body.requestId || "");
    const customerName = String(body.customerName || "").trim();
    const phone = String(body.phone || "").trim();
    const requestPhone = normalizePhone(phone);
    const itemsInput = Array.isArray(body.items) ? body.items : [];

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      return res.status(400).json({ error: "Үнийн саналын хүсэлтийн дугаар буруу байна." });
    }
    if (!customerName || customerName.length > 160 || !requestPhone || requestPhone.length < 8 || requestPhone.length > 12) {
      return res.status(400).json({ error: "Харилцагчийн нэр эсвэл утасны дугаар буруу байна." });
    }
    if (itemsInput.length < 1 || itemsInput.length > 30) {
      return res.status(400).json({ error: "Бүтээгдэхүүний мөрийн тоо буруу байна." });
    }

    const pdfBuffer = decodePdf(body.pdfBase64);
    const items = itemsInput.map(item => {
      const product = String(item.product || "").trim().slice(0, 160);
      const width = Number(item.width);
      const height = Number(item.height);
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unitPrice);
      if (!product || !Number.isFinite(width) || width <= 0 ||
          !Number.isFinite(height) || height <= 0 ||
          !Number.isFinite(quantity) || quantity <= 0 || quantity > 10000 ||
          !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1000000000) {
        throw new Error("Бүтээгдэхүүний хэмжээ, тоо эсвэл үнэ буруу байна.");
      }
      const area = width * height;
      const total = area * quantity * unitPrice;
      if (!Number.isFinite(total) || total > 100000000000) {
        throw new Error("Үнийн саналын нийт дүн хэт их байна.");
      }
      return {
        product_type: product,
        width,
        height,
        quantity,
        area,
        unit_price: unitPrice,
        total_price: total,
        pricing_mode: "materials_included"
      };
    });

    const totalArea = items.reduce((sum, item) => sum + item.area * item.quantity, 0);
    const totalPrice = items.reduce((sum, item) => sum + item.total_price, 0);
    const productSummary = items.map(item => item.product_type).join(", ");
    const sizeSummary = items.map(item =>
      item.width + "м × " + item.height + "м (" + item.quantity + "ш)"
    ).join("; ");
    const orderNumber = createOrderNumber(requestId);
    const filePath = ownerUserId + "/quote-" + requestId + ".pdf";

    // Ижил хүсэлтийг дахин илгээхэд давхар захиалга үүсгэхгүй.
    let { data: order, error: existingError } = await supabase
      .from("orders")
      .select("id, messenger_sender_id, messenger_order_number, quote_pdf_path")
      .eq("user_id", ownerUserId)
      .eq("quote_pdf_path", filePath)
      .maybeSingle();
    if (existingError) throw existingError;

    let senderId = order?.messenger_sender_id || null;
    if (!order) {
      const { data: linkedOrders, error: linkedError } = await supabase
        .from("orders")
        .select("phone, messenger_sender_id")
        .eq("user_id", ownerUserId)
        .not("messenger_sender_id", "is", null)
        .not("phone", "is", null)
        .limit(1000);
      if (linkedError) throw linkedError;

      const { data: linkedSessions, error: sessionsError } = await supabase
        .from("messenger_sessions")
        .select("phone, sender_id")
        .not("phone", "is", null)
        .limit(1000);
      if (sessionsError) throw sessionsError;

      const senderIds = [...new Set([
        ...(linkedOrders || [])
          .filter(row => normalizePhone(row.phone) === requestPhone && row.messenger_sender_id)
          .map(row => String(row.messenger_sender_id)),
        ...(linkedSessions || [])
          .filter(row => normalizePhone(row.phone) === requestPhone && row.sender_id)
          .map(row => String(row.sender_id))
      ])];

      if (senderIds.length === 0) {
        return res.status(404).json({
          error: "Энэ утасны дугаарт холбогдсон Messenger хэрэглэгч олдсонгүй. Харилцагчаар эхлээд Монгол металл хийц Facebook хуудсанд чат бичүүлээд дахин илгээнэ үү."
        });
      }
      if (senderIds.length > 1) {
        return res.status(409).json({
          error: "Энэ утасны дугаар олон Messenger хэрэглэгчтэй холбогдсон байна. Буруу хүнд илгээхээс сэргийлж илгээлтийг зогсоолоо."
        });
      }
      senderId = senderIds[0];

      const { data: inserted, error: insertError } = await supabase
        .from("orders")
        .insert({
          user_id: ownerUserId,
          customer_name: customerName,
          phone,
          product: productSummary,
          size: sizeSummary,
          area_per_unit: totalArea || 1,
          quantity: 1,
          unit_price: totalArea > 0 ? totalPrice / totalArea : totalPrice,
          price: totalPrice,
          status: "Үнийн санал",
          messenger_sender_id: senderId,
          messenger_order_number: orderNumber,
          quote_pdf_path: filePath,
          quote_items: items
        })
        .select("id, messenger_sender_id, messenger_order_number, quote_pdf_path")
        .single();
      if (insertError) throw insertError;
      order = inserted;
      createdOrderId = inserted.id;
    }

    // Өмнөх оролдлогоор файл байршуулсан эсэхийг шалгаад байхгүй бол байршуулна.
    let pdfToSend = pdfBuffer;
    const { data: storedPdf, error: storedPdfError } = await supabase.storage
      .from("quote-pdfs")
      .download(filePath);
    if (storedPdf && !storedPdfError) {
      pdfToSend = Buffer.from(await storedPdf.arrayBuffer());
    } else {
      const { error: uploadError } = await supabase.storage
        .from("quote-pdfs")
        .upload(filePath, pdfBuffer, {
          contentType: "application/pdf",
          upsert: true
        });
      if (uploadError) throw uploadError;
    }

    try {
      await sendFileAttachment(
        senderId,
        pdfToSend,
        "Mongol-Metal-Quote-" + order.messenger_order_number + ".pdf"
      );
    } catch (sendError) {
      console.error("Messenger quote PDF send failed:", sendError.message);
      return res.status(502).json({
        success: false,
        saved: true,
        orderId: order.id,
        error: "PDF хадгалагдсан боловч Messenger-ээр илгээж чадсангүй. Харилцагчийн чат нээлттэй эсэхийг шалгаад дахин оролдоно уу."
      });
    }

    try {
      const textResponse = await fetch(
        "https://graph.facebook.com/v26.0/me/messages?access_token=" + process.env.PAGE_ACCESS_TOKEN,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: senderId },
            message: { text: "📄 Сайн байна уу, " + customerName + " аа. Таны үнийн саналын PDF файлыг илгээлээ. Баярлалаа — Монгол металл хийц." }
          })
        }
      );
      if (!textResponse.ok) console.error("Messenger quote PDF confirmation text failed.");
    } catch (textError) {
      console.error("Messenger quote PDF confirmation text failed:", textError.message);
    }

    return res.status(200).json({
      success: true,
      saved: true,
      orderId: order.id,
      message: "Үнийн саналын PDF Messenger-ээр илгээгдэж, захиалгад хадгалагдлаа."
    });
  } catch (error) {
    console.error("send-quote-pdf error:", error.message);
    return res.status(500).json({
      error: error.message || "PDF илгээхэд серверийн алдаа гарлаа.",
      orderId: createdOrderId
    });
  }
}
