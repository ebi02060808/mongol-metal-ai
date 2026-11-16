import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const fields = {
  production: {
    column: "production_status",
    permission: "can_update_production_status",
    values: ["Хүлээгдэж байна", "Эхлээгүй", "Явагдаж байна", "Дууссан"],
    event: "production_status_changed",
    label: "Үйлдвэрлэл"
  },
  assembly: {
    column: "installation_status",
    permission: "can_update_installation_status",
    values: ["Хүлээгдэж байна", "Төлөвлөсөн", "Явагдаж байна", "Дууссан"],
    event: "assembly_status_changed",
    label: "Угсралт"
  },
  installation: {
    column: "site_installation_status",
    permission: "can_update_site_installation_status",
    values: ["Хүлээгдэж байна", "Төлөвлөсөн", "Явагдаж байна", "Дууссан"],
    event: "site_installation_status_changed",
    label: "Суурилуулалт"
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST хүсэлт шаардлагатай." });
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Нэвтрэх эрх шаардлагатай." });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: "Нэвтрэлт хүчингүй байна." });

    const { data: member, error: memberError } = await supabase
      .from("admin_users")
      .select("role, owner_user_id, can_update_production_status, can_update_installation_status, can_update_site_installation_status")
      .eq("user_id", user.id).maybeSingle();
    if (memberError || !member || !["admin", "employee"].includes(member.role)) {
      return res.status(403).json({ error: "Системийн эрх шаардлагатай." });
    }

    const { orderId, workType, status } = req.body || {};
    const config = fields[workType];
    if (!config || !orderId || !config.values.includes(status)) {
      return res.status(400).json({ error: "Захиалга эсвэл ажлын төлөв буруу байна." });
    }

    const ownerUserId = member.owner_user_id || user.id;
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, user_id, assigned_to, status, production_status, installation_status, site_installation_status")
      .eq("id", orderId).eq("user_id", ownerUserId).maybeSingle();
    if (orderError) throw orderError;
    if (!order) return res.status(404).json({ error: "Захиалга олдсонгүй." });

    if (member.role !== "admin") {
      if (order.assigned_to !== user.id || member[config.permission] !== true) {
        return res.status(403).json({ error: "Энэ ажлын явцыг шинэчлэх эрхгүй эсвэл захиалга танд оноогдоогүй байна." });
      }
    }

    const oldStatus = order[config.column] || "Хүлээгдэж байна";
    const pending = "Хүлээгдэж байна";
    const orderStatus = String(order.status || "Шинэ");
    if (workType === "production" && status !== pending && orderStatus !== "Баталгаажсан") {
      return res.status(409).json({ error: "Захиалга эхлээд Баталгаажсан төлөвтэй болох шаардлагатай." });
    }
    if (workType === "assembly" && status !== pending && order.production_status !== "Дууссан") {
      return res.status(409).json({ error: "Үйлдвэрлэл бүрэн Дууссаны дараа угсралтыг эхлүүлнэ." });
    }
    if (workType === "installation" && status !== pending && order.installation_status !== "Дууссан") {
      return res.status(409).json({ error: "Угсралт бүрэн Дууссаны дараа суурилуулалтыг эхлүүлнэ." });
    }
    if (workType === "production" && status !== "Дууссан" &&
        ((order.installation_status || pending) !== pending || (order.site_installation_status || pending) !== pending)) {
      return res.status(409).json({ error: "Дараагийн шат эхэлсэн тул үйлдвэрлэлийн төлөвийг буцаах боломжгүй." });
    }
    if (workType === "assembly" && status !== "Дууссан" &&
        (order.site_installation_status || pending) !== pending) {
      return res.status(409).json({ error: "Суурилуулалт эхэлсэн тул угсралтын төлөвийг буцаах боломжгүй." });
    }
    if (oldStatus === status) {
      return res.status(200).json({ success: true, message: "Төлөв өөрчлөгдөөгүй байна." });
    }

    const { data: updated, error: updateError } = await supabase
      .from("orders")
      .update({ [config.column]: status })
      .eq("id", orderId).eq("user_id", ownerUserId)
      .select("id").maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return res.status(404).json({ error: "Захиалгыг шинэчилж чадсангүй." });

    const { error: historyError } = await supabase.from("order_history").insert({
      order_id: orderId,
      user_id: ownerUserId,
      actor_user_id: user.id,
      event_type: config.event,
      old_values: { [config.column]: oldStatus },
      new_values: { [config.column]: status }
    });
    if (historyError) console.error("Work progress history insert failed:", historyError);

    return res.status(200).json({
      success: true,
      message: config.label + " явц шинэчлэгдлээ."
    });
  } catch (error) {
    console.error("Update work progress error:", error);
    return res.status(500).json({ error: "Ажлын явцыг шинэчлэхэд серверийн алдаа гарлаа." });
  }
}
