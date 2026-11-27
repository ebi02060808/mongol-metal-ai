import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "POST хүсэлт шаардлагатай." });
  }

  try {
    const accessToken = (req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
    if (!accessToken) {
      return res.status(401).json({ success: false, error: "Нэвтрэх эрх олдсонгүй." });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: "Нэвтрэлт хүчингүй байна." });
    }

    const { data: employee, error: employeeError } = await supabase
      .from("admin_users")
      .select("role, owner_user_id, can_receive_payments")
      .eq("user_id", user.id)
      .maybeSingle();

    if (employeeError) throw employeeError;
    if (!employee || employee.role !== "employee" || employee.can_receive_payments !== true) {
      return res.status(403).json({ success: false, error: "Төлбөр хүлээн авах эрх олгогдоогүй байна." });
    }

    const orderId = Number(req.body?.orderId);
    const amount = Number(req.body?.amount);
    const entryDate = String(req.body?.entryDate || "").trim();
    const description = String(req.body?.description || "").trim().slice(0, 500);

    if (!Number.isSafeInteger(orderId) || orderId <= 0 ||
        !Number.isFinite(amount) || amount <= 0 || amount > 100000000000 ||
        !/^\\d{4}-\\d{2}-\\d{2}$/.test(entryDate)) {
      return res.status(400).json({ success: false, error: "Захиалга, төлбөрийн дүн эсвэл огноо буруу байна." });
    }

    const { data: result, error: paymentError } = await supabase.rpc("receive_assigned_order_payment", {
      p_order_id: orderId,
      p_actor_user_id: user.id,
      p_amount: amount,
      p_entry_date: entryDate,
      p_description: description || null
    });

    if (paymentError) {
      console.error("Assigned order payment error:", paymentError);
      return res.status(400).json({
        success: false,
        error: paymentError.message || "Төлбөр бүртгэж чадсангүй."
      });
    }

    return res.status(200).json({
      success: true,
      ...(result && typeof result === "object" ? result : {}),
      message: result?.message || "Төлбөр амжилттай бүртгэгдлээ."
    });
  } catch (error) {
    console.error("Receive order payment API error:", error);
    return res.status(500).json({
      success: false,
      error: "Төлбөр бүртгэх үед алдаа гарлаа. Дахин оролдоно уу."
    });
  }
}
