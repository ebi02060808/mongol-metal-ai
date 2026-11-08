import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function money(value) {
  return Number(value || 0).toLocaleString("mn-MN") + " ₮";
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
      .from("admin_users").select("role").eq("user_id", user.id).maybeSingle();
    if (adminError || !admin || admin.role !== "admin") {
      return res.status(403).json({ error: "Админы эрх шаардлагатай." });
    }

    const { orderId, newStatus } = req.body || {};
    const allowedStatuses = ["Шинэ", "Холбогдсон", "Үнийн санал", "Баталгаажсан", "Дууссан"];
    if (!orderId || !allowedStatuses.includes(newStatus)) {
      return res.status(400).json({ error: "Захиалга эсвэл төлөв буруу байна." });
    }

    const { data: order, error: fetchError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!order) return res.status(404).json({ error: "Захиалга олдсонгүй." });

    const pageToken = process.env.PAGE_ACCESS_TOKEN;

    // Үнийн санал төлөв сонгоход мэдээллийг эхлээд Messenger-ээр илгээнэ.
    // Илгээлт амжилтгүй бол төлөвийг өөрчлөхгүй.
    if (newStatus === "Үнийн санал") {
      if (!order.messenger_sender_id) {
        return res.status(400).json({
          error: "Энэ захиалгад Messenger хэрэглэгчийн ID байхгүй тул үнийн санал илгээх боломжгүй."
        });
      }
      if (!pageToken) {
        return res.status(500).json({ error: "Messenger-ийн Page тохиргоо олдсонгүй." });
      }

      const quantity = Number(order.quantity || 1);
      const areaPerUnit = Number(order.area_per_unit || 1);
      const totalArea = areaPerUnit * quantity;
      const unitPrice = order.unit_price == null ? null : Number(order.unit_price);
      const totalPrice = Number(order.price || 0);
      const orderNumber = order.messenger_order_number || order.id;

      const quoteText =
        "📋 МОНГОЛ МЕТАЛЛ ХИЙЦ — ҮНИЙН САНАЛ\n\n" +
        "Сайн байна уу, " + (order.customer_name || "хүндэт харилцагч") + " аа.\n" +
        "Таны захиалгын мэдээлэлд үндэслэн үнийн саналыг хүргэж байна.\n\n" +
        "Захиалгын дугаар: " + orderNumber + "\n" +
        "Бүтээгдэхүүн: " + (order.product || "—") + "\n" +
        "Хэмжээ: " + (order.size || "—") + "\n" +
        "Тоо хэмжээ: " + quantity + " ш\n" +
        "Нийт талбай: " + totalArea.toLocaleString("mn-MN") + " м²\n" +
        "1 м² үнэ: " + (unitPrice == null ? "Тодорхойгүй" : money(unitPrice)) + "\n" +
        "НИЙТ ҮНЭ: " + money(totalPrice) + "\n\n" +
        "Энэхүү үнийн саналтай танилцаад асуух зүйл байвал бидэнд хариу бичээрэй.\n" +
        "Баярлалаа. — Монгол металл хийц";

      const messengerResponse = await fetch("https://graph.facebook.com/v26.0/me/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: order.messenger_sender_id },
          message: { text: quoteText },
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
      .update({ status: newStatus })
      .eq("id", orderId)
      .eq("user_id", user.id)
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
