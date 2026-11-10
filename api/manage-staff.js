import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function requireMember(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Нэвтрэх эрх шаардлагатай.", status: 401 };
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return { error: "Нэвтрэлт хүчингүй байна.", status: 401 };
  const { data: member, error } = await supabase
    .from("admin_users").select("role, owner_user_id").eq("user_id", user.id).maybeSingle();
  if (error || !member || !["admin", "employee"].includes(member.role)) {
    return { error: "Системийн эрх шаардлагатай.", status: 403 };
  }
  return { user, member };
}

async function requireAdmin(req) {
  const auth = await requireMember(req);
  if (auth.error) return auth;
  if (auth.member.role !== "admin") {
    return { error: "Зөвхөн админ ажилтны эрх удирдах боломжтой.", status: 403 };
  }
  return auth;
}

async function findAuthUserByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users || [];
    const match = users.find(item => String(item.email || "").toLowerCase() === normalized);
    if (match) return match;
    if (users.length < 1000) break;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST хүсэлт шаардлагатай." });
  try {
    const { action, email, userId, userIds, fullName, phone, position, canViewAllOrders, canCreateOrders } = req.body || {};

    if (action === "actor-names") {
      const auth = await requireMember(req);
      if (auth.error) return res.status(auth.status).json({ error: auth.error });
      const ownerUserId = auth.member.owner_user_id || auth.user.id;
      const requestedIds = Array.isArray(userIds)
        ? [...new Set(userIds.filter(id => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 100)
        : [];
      if (!requestedIds.length) return res.status(200).json({ success: true, actors: {} });

      // Only resolve users who actually appear in this company's own order history.
      const { data: historyRows, error: historyError } = await supabase
        .from("order_history").select("actor_user_id")
        .eq("user_id", ownerUserId).in("actor_user_id", requestedIds);
      if (historyError) throw historyError;
      const allowedIds = [...new Set((historyRows || []).map(row => row.actor_user_id).filter(Boolean))];
      const actors = {};
      for (const actorId of allowedIds) {
        const { data, error: userError } = await supabase.auth.admin.getUserById(actorId);
        const actor = data?.user;
        if (!userError && actor) {
          const metadata = actor.user_metadata || {};
          actors[actorId] = {
            name: String(metadata.full_name || [metadata.last_name, metadata.first_name].filter(Boolean).join(" ") || metadata.name || metadata.display_name || "").trim(),
            email: actor.email || ""
          };
        }
      }
      return res.status(200).json({ success: true, actors });
    }

    const auth = await requireAdmin(req);
    if (auth.error) return res.status(auth.status).json({ error: auth.error });
    const ownerUserId = auth.member.owner_user_id || auth.user.id;

    if (action === "list") {
      const { data: employees, error } = await supabase
        .from("admin_users").select("user_id, created_at, can_view_all_orders, can_create_orders")
        .eq("role", "employee").eq("owner_user_id", ownerUserId).order("created_at", { ascending: false });
      if (error) throw error;
      const result = [];
      for (const employee of employees || []) {
        const { data, error: userError } = await supabase.auth.admin.getUserById(employee.user_id);
        const metadata = userError ? {} : (data?.user?.user_metadata || {});
        result.push({
          user_id: employee.user_id,
          email: userError ? null : data?.user?.email || null,
          full_name: String(metadata.full_name || metadata.name || metadata.display_name || [metadata.last_name, metadata.first_name].filter(Boolean).join(" ") || "").trim(),
          phone: String(metadata.phone || "").trim(),
          position: String(metadata.position || "").trim(),
          created_at: employee.created_at,
          can_view_all_orders: employee.can_view_all_orders === true,
          can_create_orders: employee.can_create_orders === true
        });
      }
      return res.status(200).json({ success: true, employees: result });
    }

    if (action === "update-order-visibility") {
      if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId) || typeof canViewAllOrders !== "boolean") {
        return res.status(400).json({ error: "Ажилтан болон харах эрхийн утга буруу байна." });
      }
      const { data: employee, error: employeeError } = await supabase
        .from("admin_users").select("user_id")
        .eq("user_id", userId).eq("role", "employee").eq("owner_user_id", ownerUserId)
        .maybeSingle();
      if (employeeError) throw employeeError;
      if (!employee) return res.status(404).json({ error: "Танай байгууллагын ажилтан олдсонгүй." });

      const { error: updateError } = await supabase
        .from("admin_users")
        .update({ can_view_all_orders: canViewAllOrders })
        .eq("user_id", userId).eq("role", "employee").eq("owner_user_id", ownerUserId);
      if (updateError) throw updateError;
      return res.status(200).json({
        success: true,
        message: canViewAllOrders
          ? "Ажилтанд компанийн бүх захиалгыг харах эрх олголоо."
          : "Ажилтан зөвхөн өөрт оноосон захиалгаа харна."
      });
    }

    if (action === "update-create-permission") {
      if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId) || typeof canCreateOrders !== "boolean") {
        return res.status(400).json({ error: "Ажилтан болон захиалга үүсгэх эрхийн утга буруу байна." });
      }
      const { data: employee, error: employeeError } = await supabase
        .from("admin_users").select("user_id")
        .eq("user_id", userId).eq("role", "employee").eq("owner_user_id", ownerUserId)
        .maybeSingle();
      if (employeeError) throw employeeError;
      if (!employee) return res.status(404).json({ error: "Танай байгууллагын ажилтан олдсонгүй." });
      const { error: updateError } = await supabase
        .from("admin_users")
        .update({ can_create_orders: canCreateOrders })
        .eq("user_id", userId).eq("role", "employee").eq("owner_user_id", ownerUserId);
      if (updateError) throw updateError;
      return res.status(200).json({
        success: true,
        message: canCreateOrders
          ? "Ажилтанд шинэ захиалга үүсгэх эрх олголоо."
          : "Ажилтны шинэ захиалга үүсгэх эрхийг хаалаа."
      });
    }

    if (action === "update-profile") {
      if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId)) {
        return res.status(400).json({ error: "Ажилтны ID буруу байна." });
      }
      const cleanFullName = String(fullName || "").trim();
      const cleanPhone = String(phone || "").trim();
      const cleanPosition = String(position || "").trim();
      if (cleanFullName.length < 2 || cleanFullName.length > 120 ||
          cleanPhone.length < 6 || cleanPhone.length > 30 ||
          cleanPosition.length < 2 || cleanPosition.length > 100) {
        return res.status(400).json({ error: "Овог нэр, утас, албан тушаалыг зөв бөглөнө үү." });
      }
      const { data: employee, error: employeeError } = await supabase
        .from("admin_users").select("user_id")
        .eq("user_id", userId).eq("role", "employee").eq("owner_user_id", ownerUserId)
        .maybeSingle();
      if (employeeError) throw employeeError;
      if (!employee) return res.status(404).json({ error: "Танай байгууллагын ажилтан олдсонгүй." });

      const { data: targetData, error: targetError } = await supabase.auth.admin.getUserById(userId);
      if (targetError || !targetData?.user) {
        return res.status(404).json({ error: "Ажилтны бүртгэл олдсонгүй." });
      }
      const existingMetadata = targetData.user.user_metadata || {};
      const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
        user_metadata: { ...existingMetadata, full_name: cleanFullName, phone: cleanPhone, position: cleanPosition }
      });
      if (updateError) throw updateError;
      return res.status(200).json({ success: true, message: "Ажилтны мэдээлэл амжилттай шинэчлэгдлээ." });
    }

    if (action === "add") {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ error: "Имэйл хаягаа зөв оруулна уу." });
      }
      const target = await findAuthUserByEmail(normalizedEmail);
      if (!target) {
        return res.status(404).json({
          error: "Энэ имэйлээр бүртгэл олдсонгүй. Ажилтан эхлээд register.html хуудсаар бүртгүүлнэ үү."
        });
      }
      const { data: existing, error: existingError } = await supabase
        .from("admin_users").select("role").eq("user_id", target.id).maybeSingle();
      if (existingError) throw existingError;
      if (existing?.role === "admin") {
        return res.status(409).json({ error: "Энэ хэрэглэгч аль хэдийн админ эрхтэй байна." });
      }
      const { error } = await supabase.from("admin_users").upsert(
        { user_id: target.id, role: "employee", owner_user_id: ownerUserId },
        { onConflict: "user_id" }
      );
      if (error) throw error;
      return res.status(200).json({ success: true, message: "Ажилтны эрх амжилттай олгогдлоо." });
    }

    if (action === "remove") {
      if (!userId || userId === auth.user.id) {
        return res.status(400).json({ error: "Ажилтны ID буруу байна." });
      }
      const { data: removed, error } = await supabase
        .from("admin_users").delete()
        .eq("user_id", userId).eq("role", "employee").eq("owner_user_id", ownerUserId)
        .select("user_id").maybeSingle();
      if (error) throw error;
      if (!removed) return res.status(404).json({ error: "Ажилтан олдсонгүй эсвэл админ эрхтэй хэрэглэгч байна." });
      return res.status(200).json({ success: true, message: "Ажилтны эрх цуцлагдлаа." });
    }

    return res.status(400).json({ error: "Үйлдэл буруу байна." });
  } catch (error) {
    console.error("manage-staff error:", error);
    return res.status(500).json({ error: "Ажилтны эрх удирдахад серверийн алдаа гарлаа." });
  }
}
