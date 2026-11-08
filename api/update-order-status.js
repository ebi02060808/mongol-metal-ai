import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function money(value) {
  return Number(value || 0).toLocaleString("mn-MN") + " ₮";
}

function parseAreaFromSize(size) {
  // Жишээ: "1. 1.5 × 2.2 м, 1 ш" эсвэл "1.5x2.2"
  const match = String(size || "").match(/(\d+(?:[.,]\d+)?)\s*[×xX*]\s*(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  const width = Number(match[1].replace(",", "."));
  const height = Number(match[2].replace(",", "."));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return width * height;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST хүсэлт шаардлагатай." });
  }

  try {
    const accessToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!accessToken) return res.status(401).json({ error: "Нэвтрэх эрх олдсонгүй." });

    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user) return res.status(401).json({ error: "Нэвтрэлт хүчингүй байна." });

    const { data: admin, error: adminError } = await supabase
      .from("admin_users").select("role, owner_user_id").eq("user_id", user.id).maybeSingle();
    if (adminError || !admin || !["admin", "employee"].includes(admin.role)) {
      return res.status(403).json({ error: "Ажилтны эсвэл админы эрх шаардлагатай." });
    }

    const ownerUserId = admin.owner_user_id || user.id;
    const { orderId, newStatus } = req.body || {};
    const allowedStatuses = ["Шинэ", "Холбогдсон", "Үнийн санал", "Баталгаажсан", "Дууссан"];
    if (!orderId || !allowedStatuses.includes(newStatus)) {
      return res.status(400).json({ error: "Захиалга эсвэл төлөв буруу байна." });
    }

    const { data: order, error: fetchError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .eq("user_id", ownerUserId)
      .maybeSingle();

    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!order) return res.status(404).json({ error: "Захиалга олдсонгүй." });

    // Ижил төлөвийг дахин сонгоход Messenger-т давхар мэдэгдэл/үнийн санал илгээхгүй.
    const currentStatus = String(order.status || "Шинэ").startsWith("Шинэ захиалга")
      ? "Шинэ"
      : String(order.status || "Шинэ");
    if (currentStatus === newStatus) {
      return res.status(409).json({
        error: newStatus === "Үнийн санал"
          ? "Энэ захиалгад үнийн санал өмнө нь илгээгдсэн байна. Давхар илгээхээс хамгааллаа."
          : "Захиалга аль хэдийн энэ төлөвтэй байна."
      });
    }

    const pageToken = process.env.PAGE_ACCESS_TOKEN;
    let quotePdfPathToSave = null;

    // Үнийн санал төлөв сонгоход хэмжээг эхлээд захиалгын хэмжээсээс шалгаж бодно.
    if (newStatus === "Үнийн санал") {
      if (!order.messenger_sender_id) {
        return res.status(400).json({
          error: "Энэ захиалгад Messenger хэрэглэгчийн ID байхгүй тул үнийн санал илгээх боломжгүй."
        });
      }
      if (!pageToken) {
        return res.status(500).json({ error: "Messenger-ийн Page тохиргоо олдсонгүй." });
      }

      const quoteItems = Array.isArray(order.quote_items) ? order.quote_items : [];
      const quantity = quoteItems.length
        ? quoteItems.reduce((sum, item) => sum + Number(item.quantity || 1), 0)
        : Number(order.quantity || 1);
      const parsedArea = parseAreaFromSize(order.size);
      const storedArea = Number(order.area_per_unit || 0);
      const totalArea = quoteItems.length
        ? quoteItems.reduce((sum, item) => sum + Number(item.area || 0) * Number(item.quantity || 1), 0)
        : (parsedArea || (storedArea > 0 ? storedArea : 1)) * quantity;
      const totalPrice = Number(order.price || 0);
      const storedUnitPrice = order.unit_price == null ? 0 : Number(order.unit_price);
      const unitPrice = quoteItems.length
        ? Number(quoteItems[0].unit_price || 0)
        : (storedUnitPrice > 0 ? storedUnitPrice : (totalArea > 0 && totalPrice > 0 ? totalPrice / totalArea : null));
      const orderNumber = order.messenger_order_number || order.id;
      const pdfBase64 = typeof req.body.quotePdfBase64 === "string" ? req.body.quotePdfBase64 : "";
      if (!pdfBase64 || pdfBase64.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(pdfBase64)) {
        return res.status(400).json({ error: "Үнийн саналын PDF файл үүсээгүй байна. Дахин оролдоно уу." });
      }
      const pdfBuffer = Buffer.from(pdfBase64, "base64");
      if (!pdfBuffer.length || pdfBuffer.length > 5 * 1024 * 1024 || pdfBuffer.subarray(0, 5).toString() !== "%PDF-") {
        return res.status(400).json({ error: "PDF файлын формат буруу эсвэл хэмжээ хэтэрсэн байна." });
      }
      const quotePdfPath = ownerUserId + "/" + order.id + "/" + Date.now() + ".pdf";
      quotePdfPathToSave = quotePdfPath;
      const { error: pdfUploadError } = await supabase.storage.from("quote-pdfs").upload(quotePdfPath, pdfBuffer, {
        contentType: "application/pdf", cacheControl: "3600", upsert: false
      });
      if (pdfUploadError) {
        console.error("Quote PDF upload error:", pdfUploadError);
        return res.status(500).json({ error: "Үнийн саналын PDF хадгалагдсангүй. Дахин оролдоно уу." });
      }

      const quoteText =
        "📋 МОНГОЛ МЕТАЛЛ ХИЙЦ — ҮНИЙН САНАЛ\n\n" +
        "Сайн байна уу, " + (order.customer_name || "хүндэт харилцагч") + " аа.\n" +
        "Таны захиалгын мэдээлэлд үндэслэн үнийн саналыг хүргэж байна.\n\n" +
        "Захиалгын дугаар: " + orderNumber + "\n" +
        "Бүтээгдэхүүн: " + (order.product || "—") + "\n" +
        "Хэмжээ: " + (order.size || "—") + "\n" +
        "Тоо хэмжээ: " + quantity + " ш\n" +
        "Нийт талбай: " + totalArea.toLocaleString("mn-MN", { maximumFractionDigits: 2 }) + " м²\n" +
        (quoteItems.length
          ? quoteItems.map((item, index) =>
              (index + 1) + ". " + item.product_type + " — " +
              (item.width != null && item.height != null
                ? item.width + " × " + item.height + " м, " + item.quantity + " ш"
                : Number(item.area || 0).toFixed(2) + " м²") +
              "; " + money(item.unit_price) + "/м²; " + money(item.total_price)
            ).join("\n") + "\n"
          : "1 м² үнэ: " + (unitPrice == null ? "Тодорхойгүй" : money(unitPrice)) + "\n") +
        "НИЙТ ҮНЭ: " + money(totalPrice) + "\n\n" +
        "Энэхүү үнийн саналтай танилцаад асуух зүйл байвал бидэнд хариу бичээрэй.\n" +
        "Баярлалаа. — Монгол металл хийц";

      const messengerResponse = await fetch("https://graph.facebook.com/v26.0/me/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: order.messenger_sender_id },
          message: {
            attachment: {
              type: "template",
              payload: {
                template_type: "button",
                text: quoteText + "\n\nТанд үнийн саналын PDF файл хэрэгтэй юу?",
                buttons: [
                  { type: "postback", title: "📄 PDF авах", payload: "GET_QUOTE_PDF:" + order.id },
                  { type: "postback", title: "Үгүй, баярлалаа", payload: "DECLINE_QUOTE_PDF:" + order.id }
                ]
              }
            }
          },
          access_token: pageToken
        })
      });
      const messengerResult = await messengerResponse.json();

      if (!messengerResponse.ok || messengerResult.error) {
        console.error("Messenger quote send error:", messengerResult);
        return res.status(502).json({
          error: "Үнийн санал Messenger-ээр илгээгдсэнгүй. Захиалгын төлөв өөрчлөгдөөгүй."
        });
      }
    }

    const { data: updatedOrder, error: updateError } = await supabase
      .from("orders")
      .update(newStatus === "Үнийн санал"
        ? { status: newStatus, quote_pdf_path: quotePdfPathToSave }
        : { status: newStatus })
      .eq("id", orderId)
      .eq("user_id", ownerUserId)
      .select("id, status, messenger_sender_id, messenger_order_number")
      .maybeSingle();

    if (updateError) return res.status(500).json({ error: updateError.message });
    if (!updatedOrder) return res.status(404).json({ error: "Захиалга олдсонгүй." });

    if (newStatus !== "Үнийн санал" && updatedOrder.messenger_sender_id && pageToken) {
      const orderNumber = updatedOrder.messenger_order_number || "";
      const message = newStatus === "Баталгаажсан"
        ? "✅ Таны " + orderNumber + " дугаартай захиалгын төлбөрийг админ шалгаж баталгаажууллаа. Баярлалаа!"
        : "Таны " + orderNumber + " дугаартай захиалгын төлөв шинэчлэгдлээ: " + newStatus + ".";

      try {
        const notifyResponse = await fetch("https://graph.facebook.com/v26.0/me/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: updatedOrder.messenger_sender_id },
            message: { text: message },
            access_token: pageToken
          })
        });
        const notifyResult = await notifyResponse.json();
        if (!notifyResponse.ok || notifyResult.error) {
          console.error("Messenger status notification error:", notifyResult);
        }
      } catch (notifyError) {
        console.error("Messenger status notification error:", notifyError);
      }
    }

    return res.status(200).json({
      success: true,
      notificationSent: newStatus === "Үнийн санал" || Boolean(updatedOrder.messenger_sender_id && pageToken),
      message: newStatus === "Үнийн санал"
        ? "Үнийн санал харилцагчийн Messenger рүү илгээгдэж, төлөв шинэчлэгдлээ."
        : "Захиалгын төлөв шинэчлэгдлээ."
    });
  } catch (error) {
    console.error("Update order status error:", error);
    return res.status(500).json({ error: "Серверийн алдаа гарлаа." });
  }
}
