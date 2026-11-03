
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      message: "GET method required"
    });
  }

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Нэвтрэх эрх шаардлагатай."
      });
    }

    const { createClient } = await import("@supabase/supabase-js");

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY
    );

    // Нэвтэрсэн хэрэглэгчийг шалгах
    const { data: authData, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !authData?.user) {
      return res.status(401).json({
        success: false,
        message: "Нэвтрэх эрх хүчингүй байна."
      });
    }

    const userId = authData.user.id;

    // Админ эрх шалгах
    const { data: admin, error: adminError } = await supabase
      .from("admin_users")
      .select("user_id, role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (adminError || !admin) {
      return res.status(403).json({
        success: false,
        message: "Админ эрх шаардлагатай."
      });
    }

    const orderId = req.query.orderId;

    if (!orderId || !/^\d+$/.test(String(orderId))) {
      return res.status(400).json({
        success: false,
        message: "Захиалгын ID буруу байна."
      });
    }

    // Захиалга тухайн админд хамаарах эсэхийг шалгах
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, messenger_order_number")
      .eq("id", orderId)
      .eq("user_id", userId)
      .maybeSingle();

    if (orderError) throw orderError;

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Захиалга олдсонгүй."
      });
    }

    if (!order.messenger_order_number) {
      return res.status(200).json({
        success: true,
        photos: []
      });
    }

    // Messenger захиалгын session олох
    const { data: sessions, error: sessionError } = await supabase
      .from("messenger_sessions")
      .select("order_id, order_number")
      .eq("order_number", order.messenger_order_number);

    if (sessionError) throw sessionError;

    if (!sessions || sessions.length === 0) {
      return res.status(200).json({
        success: true,
        photos: []
      });
    }

    const sessionIds = sessions
      .map(item => item.order_id)
      .filter(Boolean);

    if (sessionIds.length === 0) {
      return res.status(200).json({
        success: true,
        photos: []
      });
    }

    // Session-тэй холбоотой зургуудыг авах
    const { data: photoRows, error: photoError } = await supabase
      .from("messenger_order_photos")
      .select("id, order_id, file_path, created_at")
      .in("order_id", sessionIds)
      .order("created_at", { ascending: false });

    if (photoError) throw photoError;

    const photos = [];

    for (const photo of photoRows || []) {
      const { data: signed, error: signedError } = await supabase
        .storage
        .from("messenger-photos")
        .createSignedUrl(photo.file_path, 300);

      if (!signedError && signed?.signedUrl) {
        photos.push({
          id: photo.id,
          url: signed.signedUrl,
          created_at: photo.created_at
        });
      }
    }

    return res.status(200).json({
      success: true,
      photos
    });

  } catch (error) {
    console.error("get-order-photos error:", error);

    return res.status(500).json({
      success: false,
      message: "Зураг авах үед алдаа гарлаа."
    });
  }
}
