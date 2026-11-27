export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "POST method required" });
  }

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return res.status(401).json({ success: false, message: "Нэвтрэх эрх шаардлагатай." });
    }

    const orderIds = req.body?.orderIds;
    if (!Array.isArray(orderIds) || orderIds.length === 0 || orderIds.length > 200 ||
        orderIds.some(id => !/^\d+$/.test(String(id)))) {
      return res.status(400).json({ success: false, message: "Захиалгын жагсаалт буруу байна." });
    }

    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY
    );

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      return res.status(401).json({ success: false, message: "Нэвтрэх эрх хүчингүй байна." });
    }

    const userId = authData.user.id;
    const { data: member, error: memberError } = await supabase
      .from("admin_users")
      .select("user_id, role, owner_user_id, can_view_all_orders")
      .eq("user_id", userId)
      .in("role", ["admin", "employee"])
      .maybeSingle();

    if (memberError || !member) {
      return res.status(403).json({ success: false, message: "Ажилтны эсвэл админы эрх шаардлагатай." });
    }

    const ownerUserId = member.owner_user_id || userId;
    const uniqueIds = [...new Set(orderIds.map(id => Number(id)))];
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id, messenger_order_number, assigned_to")
      .eq("user_id", ownerUserId)
      .in("id", uniqueIds);

    if (ordersError) throw ordersError;

    const visibleOrders = (orders || []).filter(order =>
      member.role === "admin" ||
      member.can_view_all_orders === true ||
      order.assigned_to === userId
    );
    const orderIdsByNumber = new Map();
    for (const order of visibleOrders) {
      const orderNumber = String(order.messenger_order_number || "").trim();
      if (!orderNumber) continue;
      if (!orderIdsByNumber.has(orderNumber)) orderIdsByNumber.set(orderNumber, []);
      orderIdsByNumber.get(orderNumber).push(order.id);
    }

    const orderNumbers = [...orderIdsByNumber.keys()];
    if (orderNumbers.length === 0) {
      return res.status(200).json({ success: true, photoOrderIds: [] });
    }

    const { data: sessions, error: sessionsError } = await supabase
      .from("messenger_sessions")
      .select("order_id, order_number")
      .in("order_number", orderNumbers);
    if (sessionsError) throw sessionsError;

    const sessionToOrderNumber = new Map();
    for (const session of sessions || []) {
      if (session.order_id && orderIdsByNumber.has(String(session.order_number))) {
        sessionToOrderNumber.set(String(session.order_id), String(session.order_number));
      }
    }

    const sessionIds = [...sessionToOrderNumber.keys()];
    if (sessionIds.length === 0) {
      return res.status(200).json({ success: true, photoOrderIds: [] });
    }

    const { data: photos, error: photosError } = await supabase
      .from("messenger_order_photos")
      .select("order_id")
      .in("order_id", sessionIds);
    if (photosError) throw photosError;

    const photoOrderIds = new Set();
    for (const photo of photos || []) {
      const orderNumber = sessionToOrderNumber.get(String(photo.order_id));
      for (const orderId of orderIdsByNumber.get(orderNumber) || []) {
        photoOrderIds.add(orderId);
      }
    }

    return res.status(200).json({
      success: true,
      photoOrderIds: [...photoOrderIds]
    });
  } catch (error) {
    console.error("get-order-photo-statuses error:", error);
    return res.status(500).json({
      success: false,
      message: "Зурагтай захиалгын мэдээлэл авах үед алдаа гарлаа."
    });
  }
}
