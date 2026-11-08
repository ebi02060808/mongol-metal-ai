import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function requireAdmin(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
  if (!token) return { error: "Нэвтрэх эрх шаардлагатай.", status: 401 };
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return { error: "Нэвтрэлт хүчингүй байна.", status: 401 };
  const { data: member, error } = await supabase
    .from("admin_users").select("role").eq("user_id", user.id).maybeSingle();
  if (error || !member || member.role !== "admin") {
    return { error: "Зөвхөн админ ажилтны эрх удирдах боломжтой.", status: 403 };
  }
  return { user };
}

async function findAuthUserByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(normalized)) return null;
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
    const auth = await requireAdmin(req);
    if (auth.error) return res.status(auth.status).json({ error: auth.error });

    const { action, email, userId } = req.body || {};

    if (action === "list") {
      const { data: employees, error } = await supabase
        .from("admin_users").select("user_id, created_at")
        .eq("role", "employee").order("created_at", { ascending: false });
      if (error) throw error;
      const result = [];
      for (const employee of employees || []) {
        const { data, error: userError } = await supabase.auth.admin.getUserById(employee.user_id);
        result.push({
          user_id: employee.user_id,
          email: userError ? null : data?.user?.email || null,
          created_at: employee.created_at
        });
      }
      return res.status(200).json({ success: true, employees: result });
    }

    if (action === "add") {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      if (!normalizedEmail || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ error: "Имэйл хаягаа зөв оруулна уу." });
      }
      let target = await findAuthUserByEmail(normalizedEmail);
      if (!target) {
        const { data: invited, error: inviteError } =
          await supabase.auth.admin.inviteUserByEmail(normalizedEmail);
        if (inviteError || !invited?.user) {
          return res.status(400).json({
            error: "Ажилтны урилга илгээж чадсангүй. Имэйл тохиргоо болон хаягийг шалгана уу."
          });
        }
        target = invited.user;
      }
      const { data: existing, error: existingError } = await supabase
        .from("admin_users").select("role").eq("user_id", target.id).maybeSingle();
      if (existingError) throw existingError;
      if (existing?.role === "admin") {
        return res.status(409).json({ error: "Энэ хэрэглэгч аль хэдийн админ эрхтэй байна." });
      }
      const { error } = await supabase.from("admin_users").upsert(
        { user_id: target.id, role: "employee" },
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
        .eq("user_id", userId).eq("role", "employee")
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
