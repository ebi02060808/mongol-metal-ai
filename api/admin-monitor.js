import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return sendError(res, 405, "GET эсвэл POST хүсэлт шаардлагатай.");
  }

  try {
    const accessToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!accessToken) return sendError(res, 401, "Нэвтрэх эрх олдсонгүй.");

    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user) return sendError(res, 401, "Нэвтрэлт хүчингүй байна.");

    const { data: admin, error: adminError } = await supabase
      .from("admin_users")
      .select("role, owner_user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminError || !admin || admin.role !== "admin") {
      return sendError(res, 403, "Зөвхөн админ энэ мэдээллийг харах эрхтэй.");
    }

    const ownerUserId = admin.owner_user_id || user.id;

    if (req.method === "POST") {
      const { error: readError } = await supabase
        .from("admin_monitor_reads")
        .upsert({
          admin_user_id: user.id,
          owner_user_id: ownerUserId,
          last_seen_at: new Date().toISOString()
        }, { onConflict: "admin_user_id" });
      if (readError) return sendError(res, 500, "Мэдэгдлийн уншсан төлөв хадгалж чадсангүй.");
      return res.status(200).json({ success: true });
    }

    const [ordersResult, historyResult, financeResult, staffResult, readResult] = await Promise.all([
      supabase.from("orders")
        .select("id, customer_name, product, size, price, status, created_at, order_source, assigned_to, messenger_order_number")
        .eq("user_id", ownerUserId)
        .order("created_at", { ascending: false })
        .limit(75),
      supabase.from("order_history")
        .select("id, order_id, actor_user_id, event_type, old_values, new_values, created_at")
        .eq("user_id", ownerUserId)
        .order("created_at", { ascending: false })
        .limit(150),
      supabase.from("finance_entries")
        .select("id, order_id, created_by, entry_type, amount, category, description, entry_date, created_at, counterparty, payment_method")
        .eq("user_id", ownerUserId)
        .eq("entry_type", "income")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("admin_users")
        .select("user_id, full_name, role, owner_user_id")
        .or("user_id.eq." + ownerUserId + ",owner_user_id.eq." + ownerUserId),
      supabase.from("admin_monitor_reads")
        .select("last_seen_at")
        .eq("admin_user_id", user.id)
        .maybeSingle()
    ]);

    const failed = [ordersResult, historyResult, financeResult, staffResult, readResult].find(result => result.error);
    if (failed) {
      console.error("Admin monitor query failed:", failed.error);
      return sendError(res, 500, "Хяналтын мэдээлэл ачаалж чадсангүй.");
    }

    const orders = ordersResult.data || [];
    const history = historyResult.data || [];
    const finance = financeResult.data || [];
    const names = new Map((staffResult.data || []).map(member => [
      member.user_id,
      member.full_name || (member.role === "admin" ? "Админ" : "Ажилтан")
    ]));
    const historyByOrder = new Map();
    for (const item of history) {
      if (!historyByOrder.has(item.order_id)) historyByOrder.set(item.order_id, []);
      historyByOrder.get(item.order_id).push(item);
    }

    const events = [];
    for (const order of orders) {
      const createdHistory = (historyByOrder.get(order.id) || []).find(item => item.event_type === "created");
      const actorId = createdHistory?.actor_user_id || null;
      events.push({
        id: "order-" + order.id,
        type: "new_order",
        created_at: order.created_at,
        order_id: order.id,
        order_number: order.messenger_order_number || ("#" + order.id),
        customer_name: order.customer_name || "Нэргүй",
        product: order.product || "",
        status: order.status || "",
        source: order.order_source || "Тодорхойгүй",
        actor_name: actorId ? (names.get(actorId) || "Бүртгэлтэй хэрэглэгч") : "Messenger / Систем",
        assigned_name: order.assigned_to ? (names.get(order.assigned_to) || "Хариуцагч тодорхойгүй") : "Хуваарилаагүй",
        assigned_to: order.assigned_to
      });
    }

    for (const item of history) {
      const oldValues = item.old_values || {};
      const newValues = item.new_values || {};
      let label = "";
      let previous = "";
      let next = "";

      if (item.event_type === "updated" &&
          (oldValues.assigned_to_name !== undefined || newValues.assigned_to_name !== undefined)) {
        const order = orders.find(value => value.id === item.order_id);
        events.push({
          id: "assignment-" + item.id,
          type: "assignment_change",
          created_at: item.created_at,
          order_id: item.order_id,
          order_number: order?.messenger_order_number || ("#" + item.order_id),
          customer_name: order?.customer_name || "",
          actor_name: item.actor_user_id ? (names.get(item.actor_user_id) || "Бүртгэлтэй хэрэглэгч") : "Систем",
          previous_assignee: oldValues.assigned_to_name || "Оноогоогүй",
          new_assignee: newValues.assigned_to_name || "Оноогоогүй"
        });
        continue;
      }

      if (item.event_type === "updated" && oldValues.status !== newValues.status &&
          (oldValues.status !== undefined || newValues.status !== undefined)) {
        label = "Захиалгын төлөв өөрчилсөн";
        previous = oldValues.status || "Бүртгэлгүй";
        next = newValues.status || "Бүртгэлгүй";
      } else if (["production_status_changed", "assembly_status_changed", "installation_status_changed", "site_installation_status_changed"].includes(item.event_type)) {
        label = item.event_type === "production_status_changed" ? "Үйлдвэрлэлийн явц" :
          item.event_type === "assembly_status_changed" ? "Угсралтын явц" :
          item.event_type === "installation_status_changed" ? "Суурилуулалтын явц" : "Талбайн суурилуулалт";
        previous = oldValues.status || oldValues.production_status || oldValues.installation_status || oldValues.site_installation_status || "Өмнөх төлөв";
        next = newValues.status || newValues.production_status || newValues.installation_status || newValues.site_installation_status || "Шинэ төлөв";
      } else {
        continue;
      }

      const order = orders.find(value => value.id === item.order_id);
      events.push({
        id: "history-" + item.id,
        type: "status_change",
        created_at: item.created_at,
        order_id: item.order_id,
        order_number: order?.messenger_order_number || ("#" + item.order_id),
        customer_name: order?.customer_name || "",
        actor_name: item.actor_user_id ? (names.get(item.actor_user_id) || "Бүртгэлтэй хэрэглэгч") : "Систем / өмнөх бүртгэл",
        label,
        previous_status: String(previous),
        new_status: String(next)
      });
    }

    for (const entry of finance) {
      events.push({
        id: "payment-" + entry.id,
        type: "payment",
        created_at: entry.created_at || entry.entry_date,
        order_id: entry.order_id,
        order_number: entry.order_id ? ("#" + entry.order_id) : "Ерөнхий орлого",
        customer_name: entry.counterparty || "",
        actor_name: entry.created_by ? (names.get(entry.created_by) || "Бүртгэлтэй хэрэглэгч") : "Систем",
        amount: Number(entry.amount || 0),
        category: entry.category || "Орлого",
        description: entry.description || "",
        payment_method: entry.payment_method || ""
      });
    }

    events.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    const lastSeenAt = readResult.data?.last_seen_at || null;
    const unreadCount = events.filter(event => !lastSeenAt || new Date(event.created_at) > new Date(lastSeenAt)).length;

    return res.status(200).json({
      events: events.slice(0, 150),
      unreadCount,
      lastSeenAt
    });
  } catch (error) {
    console.error("Admin monitor error:", error);
    return sendError(res, 500, "Хяналтын мэдээлэл боловсруулах үед алдаа гарлаа.");
  }
}
