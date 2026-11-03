import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST хүсэлт шаардлагатай." });
  }

  try {
    const authHeader = req.headers.authorization || "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");

    if (!accessToken) {
      return res.status(401).json({ error: "Нэвтрэх эрх олдсонгүй." });
    }

    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser(accessToken);

    if (authError || !user) {
      return res.status(401).json({ error: "Нэвтрэлт хүчингүй байна." });
    }

    const { data: admin, error: adminError } = await supabase
      .from("admin_users")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminError || !admin || admin.role !== "admin") {
      return res.status(403).json({ error: "Админы эрх шаардлагатай." });
    }

    const { orderId, newStatus } = req.body || {};

    const allowedStatuses = [
      "Шинэ",
      "Холбогдсон",
      "Үнийн санал",
      "Баталгаажсан",
      "Дууссан"
    ];

    if (!orderId || !allowedStatuses.includes(newStatus)) {
      return res.status(400).json({ error: "Захиалга эсвэл төлөв буруу байна." });
    }

    const { data: order, error: updateError } = await supabase
      .from("orders")
      .update({ status: newStatus })
      .eq("id", orderId)
      .eq("user_id", user.id)
      .select("id, status, messenger_sender_id, messenger_order_number")
      .maybeSingle();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    if (!order) {
      return res.status(404).json({ error: "Захиалга олдсонгүй." });
    }

    if (!order.messenger_sender_id) {
      return res.status(200).json({
        success: true,
        notificationSent: false,
        message: "Төлөв шинэчлэгдлээ. Messenger холболтгүй захиалга байна."
      });
    }

    const pageToken = process.env.PAGE_ACCESS_TOKEN;

    if (!pageToken) {
      return res.status(200).json({
        success: true,
        notificationSent: false,
        message: "Төлөв шинэчлэгдсэн боловч Messenger тохиргоо олдсонгүй."
      });
    }

    const orderNumber = order.messenger_order_number || "";
    const message =
      `Таны ${orderNumber} дугаартай захиалгын төлөв шинэчлэгдлээ: ${newStatus}.`;

    const messengerResponse = await fetch(
      "https://graph.facebook.com/v26.0/me/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          recipient: { id: order.messenger_sender_id },
          message: { text: message },
          access_token: pageToken
        })
      }
    );

    const messengerResult = await messengerResponse.json();

    if (!messengerResponse.ok || messengerResult.error) {
      console.error("Messenger send error:", messengerResult);

      return res.status(200).json({
        success: true,
        notificationSent: false,
        message: "Төлөв шинэчлэгдсэн. Messenger мэдэгдэл илгээгдсэнгүй."
      });
    }

    return res.status(200).json({
      success: true,
      notificationSent: true,
      message: "Төлөв шинэчлэгдэж, Messenger мэдэгдэл илгээгдлээ."
    });

  } catch (error) {
    console.error("Update order status error:", error);

    return res.status(500).json({
      error: "Серверийн алдаа гарлаа."
    });
  }
}
